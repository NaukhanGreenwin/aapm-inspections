# AA Property Management inspections (preview)

Move-in / move-out suite condition inspection, rebranded for AA Property Management & Associates Inc. (prospect) from the ITRS-built inspections app. Live: https://naukhangreenwin.github.io/aapm-inspections/ (repo NaukhanGreenwin/aapm-inspections, gh-pages branch, noindex).

Next.js 16 static export (App Router, TypeScript), basePath `/aapm-inspections`. The inspection in progress (localStorage) and its photos (IndexedDB) stay on the phone. At the end the phone builds the signed PDF with photos (`src/lib/pdf.ts`) and `src/lib/send.ts` posts it to the ITRS relay route `itrs-form-relay.onrender.com/aapm-inspection`, which emails it from info@itrapidsupport.com to nauman.khan@itrapidsupport.com ONLY (server constant). Nothing is ever sent to aapm.ca or AA staff. No download / save on device: reports leave by email only. No Microsoft sign-in in the preview.

Brand: AA navy #001D33, text blue #0068B5, button blue #0072C6; Geist + Instrument Serif (as the AA preview site). Logo from ../../logo/.

    npm install   # or symlink node_modules from the SFPM app (same package.json)
    npm run dev
    ./deploy.sh   # build + publish to gh-pages
