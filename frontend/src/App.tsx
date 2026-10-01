import { NeuralNetworkBackground } from "./components/NeuralNetworkBackground";
import { MenuSphere } from "./components/MenuSphere";
import { Chat } from "./components/Chat";

export default function App() {
  return (
    <>
      {/* Background: particle canvas at z = 0. This canvas is opaque
          and already applies its own dim (see ``DIM`` in
          ``NeuralNetworkBackground``), so nothing else is needed
          behind the menu. It used to be followed by a full-viewport
          ``rgba(0, 0, 0, 0.45)`` tint div, but that made the
          compositor blend three full-screen surfaces every frame —
          this canvas, the tint, and the transparent WebGL canvas —
          to darken a background that only this canvas draws. */}
      <NeuralNetworkBackground />
      {/* Foreground: 3D menu sphere at z = 2, transparent so the
          background shows through between the balls. It sits above
          the canvas on z-index alone; the canvas needs no z-index of
          its own since it comes first in the document. */}
      <MenuSphere />
      <Chat />
    </>
  );
}
