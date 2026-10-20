
import { useText } from "@/lib/i18n/text";
import Reveal from "./Reveal";

const SLIDES = [
  { src: "/carousel/card1.jpg", alt: "Side view portrait of modern young woman holding credit card and paying via NFC while working with laptop in cafe, copy space" },
  { src: "/carousel/card2.jpg", alt: "Credit card in hands female receptionist returning it to client after accepting payment" },
  { src: "/carousel/card3.jpg", alt: "Young happy woman doing shopping online with her laptop at home. Portrait of excited woman holding credit card and buy on an e-commerce site with copy space. Beautiful laughing girl paying online bills using debit card and computer." },
  { src: "/carousel/card4.jpg", alt: "Mobile banking and shopping online panoramic image, selective focus" },
];

export default function About() {
  const tx = useText();
  return (
    <section id="about">
      <div className="container">
        <div className="about-section">
          <div className="about-head">
            <div>
              <Reveal className="label label-accent">{tx("About QFS")}</Reveal>
              <Reveal delay={200}>
                <h2>{tx("Quantum Financial System")}</h2>
              </Reveal>
            </div>
            <Reveal delay={400} style={{ marginLeft: "auto" }}>
              <a
                className="btn"
                href="https://q-ledgerpro.live/Original%20Nesara%20PDF-1.pdf"
                target="_blank"
                rel="noreferrer"
              >{tx("QFS Manual")}</a>
            </Reveal>
          </div>

          <div className="about-cols">
            <Reveal delay={400} className="col">
              <p>{tx("QFS literal meaning is Quantum Financial System, which is an advanced financial system launched to eradicate monopoly on monetary system and for that purpose, a system that comprises of Artificial Intelligence and complex computer programs fully backed by banks is needed. Quantum Financial System would be a breakthrough in the world of banking which will lead to a new era of banking. QFS will not be influenced by Government policies, rather it will be entirely backed by tangible assets like Gold, Platinum, Oil and will not be based upon mere piece of papers which have no evidentiary value.")}</p>
            </Reveal>

            <Reveal delay={500} className="col">
              <p>{tx("The Global Currency Reset (GCR) and (NESARA GESARA) is upon us! Regulated ISO 20022 Cryptos like these below will change the world and EXPLODE really soon. The central banks are using them for the new QFS. Cryptos like XRP, XLM, XDC, ALGO, IOTA, SHX also Gold and Silver, Let me tell you more if you are interested in Nesara states Rainbow \"Treasury\" Tokens (XRP and XLM)backed by precious metals Adding Quantum & ISO20022 Internationally Regulated USA Coins also backed by metals.")}</p>
            </Reveal>
          </div>

          <Reveal animation="fadeIn" delay={600} className="qfs-carousel-wrap">
            <div className="qfs-carousel">
              {[...SLIDES, SLIDES[0], SLIDES[1]].map((slide, i) => (
                <div className="slide" key={i}>
                  <img src={slide.src} alt={slide.alt} />
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}