import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import About from "@/components/About";
import Services from "@/components/Services";
import WhyChoose from "@/components/WhyChoose";
import ProgressBars from "@/components/ProgressBars";
import HowWeWork from "@/components/HowWeWork";
import GetStarted from "@/components/GetStarted";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Features />
        <About />
        <Services />
        <WhyChoose />
        <ProgressBars />
        <HowWeWork />
        <GetStarted />
      </main>
      <Footer />
    </>
  );
}