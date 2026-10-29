/**
 * Dollars per million tiles delivered (docs/adr/0011): what an operator pays at AWS list prices, part by part.
 * Server alone: the instance and its storage for the time a million tiles take at the measured capacity,
 * plus the bytes sent to the internet. Behind a CDN: every tile is a CloudFront request and CloudFront's
 * bytes, and the origin serves only the misses (origin-to-CloudFront transfer is free). Serverless setups
 * pay per request for their misses: Lambda invocations and GB-seconds, and S3 GETs.
 */

/** A dated list-price table; prices/<region>-<date>.json holds one with its sources. */
export interface Prices {
  date: string;
  region: string;
  /** On-demand Linux, $ per hour. */
  ec2PerHour: Record<string, number>;
  gp3PerGbMonth: number;
  /** EC2 to the internet, first paid tier, $ per GB. */
  egressPerGb: number;
  /** CloudFront to viewers in the United States, first tier, $ per GB. */
  cloudfrontPerGb: number;
  cloudfrontHttpsPerMillion: number;
  lambdaPerGbSecond: { arm64: number; x86: number };
  lambdaPerMillionRequests: number;
  s3GetPerMillion: number;
}

/** AWS bills a month as 730 hours and a GB as 10^9 bytes. */
export const HOURS_PER_MONTH = 730;
const GB = 1e9;
const MILLION = 1e6;

export type Breakdown = Record<string, number> & { total: number };

function withTotal(parts: Record<string, number>): Breakdown {
  return { ...parts, total: Object.values(parts).reduce((s, v) => s + v, 0) };
}

export interface Server {
  instanceType: string;
  /** Tiles a second held within the latency target (already capped at the sustained network rate). */
  capacity: number;
  storageGb: number;
}

/** The instance and its storage for the time a million requests take at capacity. */
export function originPerMillion(p: Prices, s: Server): { instance: number; storage: number } {
  const perHour = p.ec2PerHour[s.instanceType];
  if (perHour === undefined) throw new Error(`no price for ${s.instanceType} in ${p.region} ${p.date}`);
  if (!(s.capacity > 0)) throw new Error(`capacity must be positive, got ${s.capacity}`);
  const hours = MILLION / (s.capacity * 3600);
  return { instance: perHour * hours, storage: ((s.storageGb * p.gp3PerGbMonth) / HOURS_PER_MONTH) * hours };
}

/** Server alone: the origin answers every tile and sends it to the internet. */
export function serverAlone(p: Prices, s: Server, bytesPerTile: number): Breakdown {
  return withTotal({ ...originPerMillion(p, s), egress: ((bytesPerTile * MILLION) / GB) * p.egressPerGb });
}

/** What CloudFront charges for a million tiles of this size, hits and misses alike. */
function cloudfront(p: Prices, bytesPerTile: number): { cdnRequests: number; cdnEgress: number } {
  return { cdnRequests: p.cloudfrontHttpsPerMillion, cdnEgress: ((bytesPerTile * MILLION) / GB) * p.cloudfrontPerGb };
}

/**
 * Behind a CDN: `origin.capacity` is the misses a second the server held on the miss stream, and
 * `missShare` the fraction of tiles that reach it.
 */
export function behindCdn(p: Prices, origin: Server, missShare: number, bytesPerTile: number): Breakdown {
  const o = originPerMillion(p, origin);
  return withTotal({ ...cloudfront(p, bytesPerTile), originInstance: o.instance * missShare, originStorage: o.storage * missShare });
}

/** What one miss costs a serverless setup, measured at modest volume. */
export interface PerMiss {
  lambdaInvocations: number;
  /** Billed duration times configured memory, in GB-seconds. */
  lambdaGbSeconds: number;
  lambdaArch: "arm64" | "x86";
  s3Gets: number;
}

/** Behind a CDN without a server: CloudFront for every tile, Lambda and S3 for the misses. */
export function serverless(p: Prices, perMiss: PerMiss, missShare: number, bytesPerTile: number): Breakdown {
  const misses = MILLION * missShare;
  return withTotal({
    ...cloudfront(p, bytesPerTile),
    lambda: ((misses * perMiss.lambdaInvocations) / MILLION) * p.lambdaPerMillionRequests + misses * perMiss.lambdaGbSeconds * p.lambdaPerGbSecond[perMiss.lambdaArch],
    s3: ((misses * perMiss.s3Gets) / MILLION) * p.s3GetPerMillion,
  });
}
