/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize @daytonaio/sdk to prevent bundling ESM dependencies like untildify
      // Dynamic import() in API route will handle runtime loading
      const originalExternals = config.externals;
      
      config.externals = (context, callback) => {
        // Check if it's @daytonaio/sdk - externalize it
        if (context.request?.includes('@daytonaio/sdk')) {
          return callback();
        }
        
        // Otherwise, use Next.js default external handling
        if (typeof originalExternals === 'function') {
          return originalExternals(context, callback);
        }
        
        // Fallback if originalExternals is not a function
        callback();
      };
    }
    return config;
  },
};

export default nextConfig;