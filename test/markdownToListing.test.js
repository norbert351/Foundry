// test/markdownToListing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToListing } from '../src/parser/markdownToListing.js';

test('parses H1 name + first paragraph description', () => {
  const md = `# MyAgent

This is a great agent that does AI things for builders worldwide.

More details here.`;
  const { listing } = markdownToListing(md);
  assert.equal(listing.name, 'MyAgent');
  assert.ok(listing.description.includes('great agent'));
  assert.equal(listing.services.length, 1);  // synthesized from body
});

test('parses multiple ## Service sections', () => {
  const md = `# MyAgent

Top-level description here.

## Validate Idea
First service body.

## Price Estimator
Second service body.`;
  const { listing } = markdownToListing(md);
  assert.equal(listing.name, 'MyAgent');
  assert.equal(listing.services.length, 2);
  assert.equal(listing.services[0].name, 'Validate Idea');
  assert.equal(listing.services[1].name, 'Price Estimator');
});

test('uses first non-empty line as name when no H1', () => {
  const md = `PlainName

Description goes here.`;
  const { listing } = markdownToListing(md);
  assert.equal(listing.name, 'PlainName');
});

test('defaults to SOFTWARE_SERVICES category', () => {
  const { listing } = markdownToListing('# A\n\nB');
  assert.equal(listing.category, 'SOFTWARE_SERVICES');
});

test('synthesizes a default service when body is empty', () => {
  const { listing } = markdownToListing('# A');
  assert.equal(listing.services.length, 1);
  assert.ok(listing.services[0].name);
  assert.ok(listing.services[0].description);
});

test('rejects empty draft', () => {
  assert.throws(() => markdownToListing(''));
  assert.throws(() => markdownToListing(null));
  assert.throws(() => markdownToListing(undefined));
});
