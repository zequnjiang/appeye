import { SaxesParser } from 'saxes';

type ReviewSourceErrorCode =
  'google-review-rpc-error' | 'apple-review-invalid-xml' | 'apple-review-invalid-feed';

/** Source bodies remain in the HTTP journal; errors never include review text. */
export class ReviewSourceValidationError extends Error {
  constructor(
    readonly code: ReviewSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewSourceValidationError';
  }
}

/** Only explicit errors in the requested reviews RPC are rejected, including partial payloads. */
export function validateGoogleReviewResponse(body: string): void {
  const start = body.indexOf('[');
  if (start < 0) return; // The SDK remains responsible for malformed/missing envelopes.
  const remainder = body.slice(start);
  for (const candidate of [remainder, ...remainder.split('\n')]) {
    let frames: unknown;
    try {
      frames = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (!Array.isArray(frame) || frame[0] !== 'wrb.fr' || frame[1] !== 'UsvDTd') continue;
      const error = frame[5];
      const code = Array.isArray(error) ? error[0] : undefined;
      if (typeof code === 'number' && Number.isFinite(code) && code !== 0)
        throw new ReviewSourceValidationError(
          'google-review-rpc-error',
          `Google Play reviews source RPC UsvDTd returned error code ${code}`,
        );
    }
  }
}

/**
 * Apple currently serves Atom XML. No metadata fields or review count are required:
 * empty feeds and entries describing the app itself are legitimate. Saxes performs
 * local XML parsing only; no schema/DTD validation or remote entity resolution.
 */
export function validateAppleReviewResponse(body: string): void {
  const parser = new SaxesParser({ xmlns: true });
  let rootSeen = false;
  let atomFeed = false;
  parser.on('opentag', (tag) => {
    if (rootSeen) return;
    rootSeen = true;
    atomFeed = tag.local === 'feed' && tag.uri === 'http://www.w3.org/2005/Atom';
  });
  parser.on('error', () => {
    throw new ReviewSourceValidationError(
      'apple-review-invalid-xml',
      'Apple reviews source is not well-formed XML',
    );
  });
  parser.write(body).close();
  if (!rootSeen || !atomFeed)
    throw new ReviewSourceValidationError(
      'apple-review-invalid-feed',
      'Apple reviews source does not have the expected Atom feed root',
    );
}
