import { StandalonePos } from "../../components/standalone-pos";
import localFont from "next/font/local";

const inter = localFont({
  src: "../../fonts/Inter-Variable.ttf",
  variable: "--font-pos-inter",
  display: "swap",
  weight: "100 900",
  style: "normal",
});

export default function Page() { return <div className={inter.variable}><StandalonePos /></div>; }
