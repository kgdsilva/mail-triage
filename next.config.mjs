/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    /**
     * Server Actions default to a 1 MB body, which rejected even a small scan.
     *
     * 4.5 MB and not more: that is Vercel's platform cap on a function's request body,
     * on every plan, and it is enforced before our code runs — a larger value here
     * would only move the failure, not remove it. Files above this never travel through
     * a server action at all; the upload form PUTs them straight to object storage with
     * a signed URL (see src/components/upload-form.tsx). This limit covers the local
     * development path, where there is no object storage to sign against.
     */
    serverActions: {
      bodySizeLimit: '4.5mb',
    },
  },
}

export default nextConfig
