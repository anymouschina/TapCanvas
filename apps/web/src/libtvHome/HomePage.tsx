import React from "react";
import Navbar from "./sections/Navbar";
import VideoHero from "./sections/VideoHero";
import "./libtvHome.css";

export default function HomePage({ onCreate }: { onCreate: (idea?: string) => void }): JSX.Element {
  const [idea, setIdea] = React.useState("");
  return (
    <div className="libtv-home min-h-screen bg-[#141414]">
      <Navbar onCreate={() => onCreate()} />
      <main className="libtv-home__main">
        <VideoHero
          idea={idea}
          onIdeaChange={setIdea}
          onCreate={() => onCreate(idea)}
        />
      </main>
    </div>
  );
}
