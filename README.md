# Label Scanner (Vercel + Upstash)

Mobile se label ki photo -> AWB (barcode), Order ID, Seller, SKU -> Upstash Redis me save.
Mobile aur computer dono par same data. Excel import/export.

## Setup
1. Is folder ko GitHub repo me upload karo.
2. vercel.com -> Add New -> Project -> repo chuno -> Deploy.
3. Vercel project -> Storage -> Create Database -> Upstash (Redis) -> free plan -> project se Connect.
   (Isse UPSTASH_REDIS_REST_URL / TOKEN ya KV_REST_API_URL / TOKEN env vars apne aap judte hain.)
4. Project -> Settings -> Environment Variables -> naya variable:
   Name: APP_PASSCODE   Value: aapka passcode
5. Deployments -> latest deployment ke ... menu -> Redeploy.
6. Link mobile aur computer dono par kholo, pehli baar passcode daalo.

## Files
- index.html     : poori app
- api/labels.js  : server function (Upstash se baat karta hai, passcode check karta hai)
- vercel.json    : Vercel setting
