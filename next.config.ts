import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las fuentes del carrusel se leen del disco en tiempo de ejecucion, y el
  // trazado automatico de Vercel no las ve porque nadie las importa: solo se
  // referencian por ruta. Sin esto, el render falla en produccion y funciona en
  // local, que es la peor forma de enterarse.
  //
  // Lo mismo con ffmpeg (las laminas animadas de precios): es un binario que se
  // ejecuta, no un modulo que se importa.
  outputFileTracingIncludes: {
    "/api/**": ["./src/engine/render/fonts/**", "./node_modules/ffmpeg-static/ffmpeg"],
  },
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
