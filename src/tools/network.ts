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

/** The target (or a redirect hop) is not an approved public destination. Never retried, never contacted. */
export class BlockedTargetError extends Error { constructor(message: string) { super(message); this.name = 'BlockedTargetError'; } }

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
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new BlockedTargetError('Unsicheres Quellenziel.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.includes('%')) throw new BlockedTargetError('Lokale Quellenziele sind gesperrt.');
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new BlockedTargetError('Nicht öffentliche IP-Adresse gesperrt.');
  } else if (!host.includes('.')) throw new BlockedTargetError('Nur öffentliche Hostnamen sind zulässig.');
  return url;
}

export async function resolvePublicTarget(input: string, resolve: Resolver = hostname => lookup(hostname, { all: true, verbatim: true })): Promise<PublicTarget> {
  const url = validatePublicUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
    : await resolve(hostname);
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new BlockedTargetError('DNS-Ziel ist nicht öffentlich.');
  return { url, ...addresses[0]! };
}

/** Decodes a response body using the declared charset (header first, then an early <meta>), defaulting to UTF-8. */
export function decodeBody(body: Buffer, contentType: string): string {
  const declared = /charset=["']?([\w:.-]+)/i.exec(contentType)?.[1]
    ?? /<meta[^>]+charset=["']?([\w:.-]+)/i.exec(body.subarray(0, 2048).toString('latin1'))?.[1];
  try { return new TextDecoder(declared ?? 'utf-8').decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}

/** The validated address is used by the socket; DNS is never resolved a second time. */
function requestPinned(target: PublicTarget, signal: AbortSignal, accept = 'text/html, text/plain;q=0.9'): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? https : http;
    const request = transport.request(target.url, {
      agent: false, signal, family: target.family,
      headers: { 'User-Agent': 'TrustLens/1.0 public-source-reader', Accept: accept, 'Accept-Encoding': 'identity' },
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

export type Dependencies = { resolve?: Resolver; request?: (target: PublicTarget, signal: AbortSignal, accept?: string) => Promise<PageResponse> };
export type Resource = { status: number; finalUrl: URL; contentType: string; body: string };
export interface ResourceOptions {
  /** Content types that may be read; any other type is rejected before the body is used. */
  accept?: RegExp;
  acceptHeader?: string;
  /** Applied to the first URL and to every redirect target, so a redirect can never leave an approved set of destinations. */
  allowUrl?: (url: URL) => boolean;
}
const TEXT_TYPES = /^(text\/(html|plain)|application\/xhtml\+xml)(;|$)/i;
const REDIRECTS = [301, 302, 303, 307, 308];

/**
 * Reads one public resource. Every hop (first request and each redirect) is validated, resolved and pinned to the
 * checked IP address. Non-2xx statuses are returned, not thrown, so callers can tell a login wall from a missing page.
 */
export async function safeFetchResource(requestedUrl: string, parentSignal: AbortSignal, dependencies: Dependencies = {}, options: ResourceOptions = {}): Promise<Resource> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(12_000)]);
  const accept = options.accept ?? TEXT_TYPES;
  let current = requestedUrl;
  for (let redirects = 0; redirects <= 4; redirects++) {
    signal.throwIfAborted();
    const hop = validatePublicUrl(current);
    if (options.allowUrl && !options.allowUrl(hop)) throw new BlockedTargetError('Weiterleitung verlässt die erlaubten Plattformadressen.');
    const target = await abortable(resolvePublicTarget(current, dependencies.resolve), signal);
    const response = await abortable((dependencies.request ?? requestPinned)(target, signal, options.acceptHeader), signal);
    if (REDIRECTS.includes(response.status)) {
      if (!response.headers.location || redirects === 4) throw new Error('Ungültige oder zu viele Weiterleitungen.');
      current = new URL(response.headers.location, target.url).href;
      continue;
    }
    const contentType = String(response.headers['content-type'] ?? '');
    if (response.status >= 200 && response.status < 300 && !accept.test(contentType)) throw new Error('Quelle liefert kein unterstütztes Textformat.');
    if (Buffer.byteLength(response.body) > MAX_BYTES) throw new Error('Quelle überschreitet das Größenlimit.');
    return { status: response.status, finalUrl: target.url, contentType, body: response.body };
  }
  throw new Error('Weiterleitungslimit erreicht.');
}

export async function safeFetchPage(requestedUrl: string, parentSignal: AbortSignal, dependencies: Dependencies = {}): Promise<Page> {
  const resource = await safeFetchResource(requestedUrl, parentSignal, dependencies);
  if (resource.status < 200 || resource.status >= 300) throw new Error(`Quelle nicht erreichbar (HTTP ${resource.status}).`);
  const { finalUrl, contentType, body } = resource;
  if (/^text\/plain/i.test(contentType)) return { requestedUrl, finalUrl: finalUrl.href, title: finalUrl.hostname, publisher: finalUrl.hostname, publishedAt: null, updatedAt: null, text: body };
  const $ = load(body);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text() || finalUrl.hostname;
  const publisher = $('meta[property="og:site_name"]').attr('content') || finalUrl.hostname;
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
  return { requestedUrl, finalUrl: finalUrl.href, title: title.slice(0, 500), publisher: publisher.slice(0, 200), publishedAt, updatedAt, text };
}
