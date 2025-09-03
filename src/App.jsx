import React from 'react';
import GameOfLife3D from './GameOfLife3D';
import { AiOutlineArrowDown } from 'react-icons/ai';
import NavBar from './NavBar';
import Hero from './Hero';
import About from "./About";
import GridTiles from "./GridTiles";
import Contact from "./Contact";
import TileGrid from "./TileGrid";

const App = () => {
  return (
    <div className="relative h-screen w-full">
      <NavBar />
      <div id="home"><Hero/></div>
      <div id="skills"><About/></div>
      <div id="projects"><TileGrid/></div>
      <div id="contact"><Contact/></div>
    </div>
  );
};

export default App;