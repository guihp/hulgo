/** No-op Next cache helpers for offline smoke scripts. */
function revalidatePath() {}
function revalidateTag() {}
function unstable_cache(fn) {
  return fn;
}

module.exports = {
  revalidatePath,
  revalidateTag,
  unstable_cache,
};
