# What's for Dinner? 🍽️

Swipe. Match. Eat. The group dinner decider.

## How it works

1. **Create a group** — you get a 4-letter code + QR code.
2. **Friends join** from their own phones (code or QR scan). Kids without phones get added as pass-the-phone players — one device goes around the table.
3. **Build the deck** — nearby restaurants & fast food (from your location, via OpenStreetMap) + your saved home recipes.
4. **Everyone swipes** — right for yes, left for pass. Drag the card or use the buttons.
5. **First match wins** — the first option *everyone* swipes right on is dinner. If nobody gets unanimous, majority rules (most yes votes wins).
6. **Directions** — restaurant matches link straight to Google Maps directions.

## Run it

```bash
cd server
npm install
npm start
# Open http://localhost:3000 on your phone (same Wi-Fi) or deploy anywhere Node runs
```

## Install on your phone (PWA)

Open the URL in your phone browser → Share → Add to Home Screen. It runs full-screen like a native app, no App Store needed.

## What's in v1

- ✅ Group create/join via code + QR
- ✅ Pass-the-phone mode for kids / phoneless players
- ✅ Swipe deck (drag + buttons)
- ✅ Unanimous match → majority fallback
- ✅ Nearby restaurants via geolocation + OpenStreetMap (free, no API key)
- ✅ Home recipe manager (saved in browser)
- ✅ Google Maps directions on restaurant matches
- ✅ PWA installable

## Built for v2 (data model ready, UI not yet built)

- **Featured restaurants** — cards carry a `featured` flag and sort first in the deck. The restaurant-pays-to-be-featured monetization plugs in here: a restaurant dashboard + payment flow would set `featured: true` on their card.
- **Accounts** — save recipes, favorite spots, and group history across devices (currently recipes live in browser localStorage).
- **Google Places** — swap OpenStreetMap for Google Places for richer restaurant data (photos, ratings, hours).

## Notes

- Sessions live in server memory and expire after 24 hours. No database needed for v1.
- Restaurant lookup uses the free Overpass API (OpenStreetMap). Heavy use can be slow; a bigger radius or retry usually fixes it.
