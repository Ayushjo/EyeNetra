import { E2EHarness } from "@/components/dev/E2EHarness";
import { KioskApp } from "@/components/kiosk/KioskApp";

/**
 * The KG Optic kiosk: आरव (the AI consultant) talks with the customer
 * first, then shows curated frames on their face, then lens, close and a
 * handoff to staff. Staff watch and take over from /staff. The previous
 * developer try-on view lives at /studio.
 */
export default function Home() {
  return (
    <>
      <E2EHarness />
      <KioskApp />
    </>
  );
}
