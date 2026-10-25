/**
 * Regression coverage for the upload-only offer policy.
 *
 * Creators should only be able to reach the offer form from a previously
 * uploaded asset. This test ensures the guard rejects empty or missing IDs and
 * accepts only a valid uploaded-video identifier.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { canCreateOfferFromUploadedVideo } = require("./offerAccess.js");

test("creators must start from an uploaded video before creating an offer", () => {
  assert.equal(canCreateOfferFromUploadedVideo(null), false);
  assert.equal(canCreateOfferFromUploadedVideo("   "), false);
  assert.equal(canCreateOfferFromUploadedVideo("video_123"), true);
});
