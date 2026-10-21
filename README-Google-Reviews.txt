TOP TRIP — Google Maps Reviews setup
====================================

Files in this package
- index.html: the original homepage with a new Google reviews section directly below the trips/experiences section.
- functions/api/google-reviews.js: Cloudflare Pages Function that calls Google Places API without exposing the API key in browser JavaScript.

IMPORTANT
The new section will show live Google data only after the Cloudflare Function and Google Places API key are configured. Do not publish an API key inside index.html or any public JavaScript file.

1) Google Cloud
- Open https://console.cloud.google.com/
- Create/select a project.
- Enable Places API (New) for that project.
- Configure billing if Google requires it for the API.
- Create an API key.
- Restrict the key to Places API (New). Because this key is used server-side by Cloudflare, do not rely on HTTP-referrer restrictions; use API restrictions and any supported server-side controls.

2) Upload the files to the ROOT of the GitHub repository used by Cloudflare Pages
The repository structure must look like this:
  index.html
  functions/
    api/
      google-reviews.js

Do not upload the functions folder inside another nested folder. It must sit beside index.html.

3) Add the API key as a Cloudflare Pages secret
- Cloudflare Dashboard > Workers & Pages > choose the top-trip Pages project.
- Settings > Variables and Secrets (wording may vary).
- Add a secret/environment variable named:
  GOOGLE_PLACES_API_KEY
- Paste the Google API key as its value and save.
- Redeploy the project after adding the secret if Cloudflare asks.

4) Test
Open:
  https://top-trip.pages.dev/api/google-reviews
It should return JSON with the business rating and the reviews Google makes available to Places API.
Then open the homepage and scroll to the new “آراء العملاء” section.

Notes
- Google Places API returns a limited selection of reviews (up to five per place request), not necessarily every review on Google Maps.
- Google API usage may incur charges depending on current Google Maps Platform pricing, account credits, and request volume. Check the current Google Cloud billing/pricing page before enabling it.
- The section includes a direct link to the Google Maps listing and Google attribution.
- The place is searched by the business name/address from the shared Maps link. Check the returned place name and rating after setup to make sure Google matched the correct listing.
