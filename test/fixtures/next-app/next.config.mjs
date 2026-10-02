// The SDK is linked from the repo (outside this project): let the bundler
// follow it there. Nothing is downloaded at build time.
export default {
  outputFileTracingRoot: '/',
  turbopack: {root: '/'},
  images: {unoptimized: true},
};
