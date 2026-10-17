/**
 * True on hosts that freeze or recycle instances between requests: Vercel, and Netlify (Next.js on
 * AWS Lambda). SERVERLESS=1 forces it for any other such host.
 */
export const serverless = Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS === '1');
