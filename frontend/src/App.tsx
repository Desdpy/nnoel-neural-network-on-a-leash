import { NeuralNetworkBackground } from "./components/NeuralNetworkBackground";
import { MenuSphere } from "./components/MenuSphere";
import { Chat } from "./components/Chat";
import "./App.css";

export default function App() {
  return (
    <>
      {/* Background: particle canvas at z = 0 */}
      <NeuralNetworkBackground />
      {/* Dark tint overlay at z = 1 — a fixed full-viewport
          semi-transparent black sheet that sits between the
          neural network background and the menu. Dims the
          background particles so the menu balls and labels
          stand out more without changing the background's own
          colors. Opacity is the only knob here — increase for a
          more dramatic effect. */}
      <div
        aria-hidden="true"
        className="bg-tint"
      />
      {/* Foreground: 3D menu sphere at z = 2, transparent so the
          background (now dimmed by the tint) shows through
          between the balls. */}
      <MenuSphere />
      <Chat />
    </>
  );
}