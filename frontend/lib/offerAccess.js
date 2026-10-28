/**
 * Guard for the creator-offer flow.
 *
 * ANZA requires every offer to start from a video that has already been
 * uploaded to the creator's library. A direct form submission without a
 * selected library video is blocked here before the page renders.
 */
function canCreateOfferFromUploadedVideo(videoId) {
  return typeof videoId === "string" && videoId.trim().length > 0;
}

module.exports = {
  canCreateOfferFromUploadedVideo,
};
