// Cloudflare Pages Function: /api/google-reviews
// Configure GOOGLE_PLACES_API_KEY as a secret environment variable in Cloudflare Pages.
export async function onRequestGet({ env }) {
  const apiKey = env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "GOOGLE_PLACES_API_KEY is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const endpoint = "https://places.googleapis.com/v1/places:searchText";
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.rating",
    "places.userRatingCount",
    "places.googleMapsUri",
    "places.reviews.name",
    "places.reviews.relativePublishTimeDescription",
    "places.reviews.rating",
    "places.reviews.text",
    "places.reviews.originalText",
    "places.reviews.authorAttribution",
    "places.reviews.publishTime",
    "places.reviews.googleMapsUri"
  ].join(",");

  try {
    const googleResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask
      },
      body: JSON.stringify({
        textQuery: "TOPTRIP، المنقاع، العلا 43543",
        languageCode: "ar",
        regionCode: "SA",
        maxResultCount: 1
      })
    });

    const payload = await googleResponse.json();

    if (!googleResponse.ok) {
      // Keep the API key and raw upstream details out of the public response.
      console.error("Google Places API request failed:", googleResponse.status);
      return Response.json(
        { error: "Google Places API request failed" },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const place = Array.isArray(payload.places) ? payload.places[0] : null;

    if (!place) {
      return Response.json(
        { error: "TOPTRIP place was not found by Google Places API" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    const reviews = (Array.isArray(place.reviews) ? place.reviews : []).map((review) => ({
      authorName: review.authorAttribution?.displayName || "Google user",
      authorUri: review.authorAttribution?.uri || "",
      rating: Number(review.rating) || 0,
      text: review.text?.text || review.originalText?.text || "",
      relativeTime: review.relativePublishTimeDescription || "",
      mapsUri: review.googleMapsUri || place.googleMapsUri || ""
    }));

    return Response.json(
      {
        name: place.displayName?.text || "TOPTRIP",
        rating: typeof place.rating === "number" ? place.rating : null,
        userRatingCount: Number(place.userRatingCount) || 0,
        mapsUrl: place.googleMapsUri || "https://maps.app.goo.gl/Hzjh29MM7LymawSP7?g_st=ac",
        reviews
      },
      {
        headers: {
          "Cache-Control": "public, max-age=900",
          "X-Content-Type-Options": "nosniff"
        }
      }
    );
  } catch (error) {
    console.error("Google reviews function error:", error);
    return Response.json(
      { error: "Unable to load Google reviews" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
