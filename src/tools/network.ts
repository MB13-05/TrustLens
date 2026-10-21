import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';

type Address = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<Address[]>;
export type PublicTarget = Address & { url: URL };
type PageResponse = { status: number; headers: http.IncomingHttpHeaders; body: string };
export type Page = { requestedUrl: string; finalUrl: string; title: string; publisher: string; publishedAt: string | null; updatedAt: string | null; text: string };
const MAX_BYTES = 1_000_000;

/** Conservative global-unicast policy, including special-use transition ranges. */
export function isPublicAddress(value: string): boolean {
  try {
    const address = ipaddr.parse(value);
    // NAT64 (RFC 6052) well-known prefix: the target is the embedded IPv4 address, so that one decides.
    if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).match(ipaddr.IPv6.parse('64:ff9b::'), 96)) {
      return isPublicAddress((address as ipaddr.IPv6).toByteArray().slice(12).join('.'));
    }
    if (address.range() !== 'unicast') return false;
    if (address.kind() === 'ipv4') return true;
    const ipv6 = address as ipaddr.IPv6;
    return ipv6.match(ipaddr.IPv6.parse('2000::'), 3)
      && !['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'].some(cidr => {
        const [network, prefix] = ipaddr.parseCIDR(cidr);
        return ipv6.match(network as ipaddr.IPv6, prefix);
      });
  } catch { return false; }
}

export function validatePublicUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Unsicheres Quellenziel.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.includes('%')) throw new Error('Lokale Quellenziele sind gesperrt.');
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new Error('Nicht öffentliche IP-Adresse gesperrt.');
  } else if (!host.includes('.')) throw new Error('Nur öffentliche Hostnamen sind zulässig.');
  return url;
}

export async function resolvePublicTarget(input: string, resolve: Resolver = hostname => lookup(hostname, { all: true, verbatim: true })): Promise<PublicTarget> {
  const url = validatePublicUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
    : await resolve(hostname);
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error('DNS-Ziel ist nicht öffentlich.');
  return { url, ...addresses[0]! };
}

/** Decodes a response body using the declared charset (header first, then an early <meta>), defaulting to UTF-8. */
export function decodeBody(body: Buffer, contentType: string): string {
  const declared = /charset=["']?([\w:.-]+)/i.exec(contentType)?.[1]
    ?? /<meta[^>]+charset=["']?([\w:.-]+)/i.exec(body.subarray(0, 2048).toString('latin1'))?.[1];
  try { return new TextDecoder(declared ?? 'utf-8').decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}

/** The validated address is used by the socket; DNS is never resolved a second time. */
function requestPinned(target: PublicTarget, signal: AbortSignal): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? https : http;
    const request = transport.request(target.url, {
      agent: false, signal, family: target.family,
      headers: { 'User-Agent': 'TrustLens/1.0 public-source-reader', Accept: 'text/html, text/plain;q=0.9', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        resolve({ status, headers: response.headers, body: '' });
        return;
      }
      if (Number(response.headers['content-length'] ?? 0) > MAX_BYTES || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.destroy(); reject(new Error('Quelle zu groß oder komprimiertes Format nicht unterstützt.')); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(new Error('Quelle überschreitet das Größenlimit.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status, headers: response.headers, body: decodeBody(Buffer.concat(chunks), String(response.headers['content-type'] ?? '')) }));
    });
    request.on('error', reject);
    request.end();
  });
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Abruf abgebrochen.'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function safeFetchPage(requestedUrl: string, parentSignal: AbortSignal, dependencies: { resolve?: Resolver; request?: typeof requestPinned } = {}): Promise<Page> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(12_000)]);
  let current = requestedUrl;
  for (let redirects = 0; redirects <= 4; redirects++) {
    signal.throwIfAborted();
    const target = await abortable(resolvePublicTarget(current, dependencies.resolve), signal);
    const response = await abortable((dependencies.request ?? requestPinned)(target, signal), signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.location || redirects === 4) throw new Error('Ungültige oder zu viele Weiterleitungen.');
      current = new URL(response.headers.location, target.url).href;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Quelle nicht erreichbar (HTTP ${response.status}).`);
    const contentType = response.headers['content-type'] ?? '';
    if (!/^(text\/(html|plain)|application\/xhtml\+xml)(;|$)/i.test(contentType)) throw new Error('Quelle liefert kein unterstütztes Textformat.');
    if (Buffer.byteLength(response.body) > MAX_BYTES) throw new Error('Quelle überschreitet das Größenlimit.');
    if (/^text\/plain/i.test(contentType)) return { requestedUrl, finalUrl: target.url.href, title: target.url.hostname, publisher: target.url.hostname, publishedAt: null, updatedAt: null, text: response.body };
    const $ = load(response.body);
    const title = $('meta[property="og:title"]').attr('content') || $('title').first().text() || target.url.hostname;
    const publisher = $('meta[property="og:site_name"]').attr('content') || target.url.hostname;
    const date = (selector: string) => {
      const value = $(selector).first().attr('content');
      return value && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
    };
    const publishedAt = date('meta[property="article:published_time"], meta[name="date"]');
    const updatedAt = date('meta[property="article:modified_time"], meta[property="og:updated_time"]');
    $('script, style, noscript, iframe, svg, nav, footer, header, form, aside, [hidden], [aria-hidden="true"], [role="navigation"], sup.reference, .mw-editsection, .navbox').remove();
    $('p, div, section, article, h1, h2, h3, li, br, tr').each((_index, node) => { $(node).append('\n'); });
    const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
    const text = root.text().split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (!text) throw new Error('Kein lesbarer Quellentext gefunden.');
    return { requestedUrl, finalUrl: target.url.href, title: title.slice(0, 500), publisher: publisher.slice(0, 200), publishedAt, updatedAt, text };
  }
  throw new Error('Weiterleitungslimit erreicht.');
}
