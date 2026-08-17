/**
 * SEC-82 (item 2) — the V1 recommendations route must not serve on a public,
 * long-lived shared cache. A `public, s-maxage=300, swr=900` header let an edge
 * cache keep serving a profile's recommendations for minutes after it was
 * suspended (the DB filters `is_suspended=false`, but a pre-suspension fill
 * outlives it on the CDN). The route is aligned to the V2 posture:
 * `private, max-age=60, stale-while-revalidate=300`. Source assertion locks it
 * against regression.
 */
import fs from 'fs';
import path from 'path';
import { SRC } from '../support/source-paths';

const root = path.join(__dirname, '../..');
const v1 = path.join(root, SRC.slugRoute);

describe('SEC-82: V1 recommendations cache policy', () => {
  let content: string;
  beforeAll(() => {
    content = fs.readFileSync(v1, 'utf8');
  });

  test('uses a private, short-TTL Cache-Control', () => {
    expect(content).toMatch(/'Cache-Control':\s*'private,\s*max-age=60,\s*stale-while-revalidate=300'/);
  });

  test('no longer serves on a public shared cache', () => {
    // Assert on the actual header value, not comment prose (which references
    // the old policy for context).
    expect(content).not.toMatch(/Cache-Control':\s*'public/);
  });
});
