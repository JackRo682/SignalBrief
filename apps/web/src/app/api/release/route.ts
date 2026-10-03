export const dynamic="force-dynamic";
/** Public build identity only: never include environment variables or credentials. */
export function GET(){return Response.json({release:"reference-screen-r2",commit:process.env.VERCEL_GIT_COMMIT_SHA??null,branch:process.env.VERCEL_GIT_COMMIT_REF??null},{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
