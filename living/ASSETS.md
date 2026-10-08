# Every upload is findable

Any app made from this family can search its own photos, voice notes, video and documents, but
only the uploads that were handed to the index. An upload nobody indexed is invisible to search
and nothing says so. This contract makes that impossible to do by accident.

## The rule

A file under `src/` that writes uploaded media must index it with
[`@supersuit/asset-index`](https://github.com/SupersuitUp/asset-index#readme), or say in a
comment why it does not. `node living/asset-contract.mjs` enforces it, and a template adds that
command to its own `living:check`.

## The three duties

1. **After an upload is finalized, call `indexAsset`.** Do it inside next/server `after()`, so the
   response is not held up and a slow index never fails an upload.
2. **Mount `assetSearchHandlers`** at `src/app/api/asset-search/route.ts`. That is the one route
   the app's search box talks to.
3. **When an asset is deleted, call `forgetAsset`.** Otherwise search keeps finding a thing that
   no longer exists.

The package README has the exact calls and options.

## What counts as a writer

A non-test file under `src/` (test, spec, `__fixtures__` and `node_modules` are skipped) that:

- calls `.save(` or `.createWriteStream(` on a bucket file (the same line mentions `file(`), or
- calls `getSignedUrl(` with `action: 'write'` in the same call, on any number of lines.

## How a writer complies

Any one of these:

- the file imports `@supersuit/asset-index` (either entry point);
- the file imports a relative module that imports it (one hop, `./x`, `./x.ts` or `./x/index.ts`);
- the file carries the exemption comment below.

When any writer is not exempt, `package.json` must list `@supersuit/asset-index` in `dependencies`.

## The exemption comment

```ts
// asset-index: exempt thumbnails are derived; the original is indexed where it is uploaded
```

The reason after `exempt` is required. A bare marker does not count, because a reason is what
tells the next reader whether the exemption is still true. Use it for derived files (thumbnails,
transcodes), for scratch files that are deleted, and for writers whose caller indexes the result.
