import React, { useState } from 'react';
import Lottie from 'react-lottie';
import animation1 from './chess.json';
import animation2 from './grabby2.json';
import animation3 from './fire.json';
import animation4 from './whitelife.json';

const TileGrid = () => {
  const [revealedTiles, setRevealedTiles] = useState([]);

  const handleTileClick = (index) => {
    setRevealedTiles((prevRevealedTiles) => {
      if (prevRevealedTiles.includes(index)) {
        return [];
      } else {
        return [index];
      }
    });
  };

  const tiles = [
    {
      animation: animation1,
      title: 'Chess Engine',
      content: 'Software Project',
      description: 'A decent chess engine built using C++.',
      features: ['AI opponent from terminal', 'Move analysis', 'Plays at ~1200 ELO'],
    },
    {
      animation: animation2,
      title: 'Grabby - OCR + Snipping Tool',
      content: 'Software Project',
      description: 'A versatile tool combining OCR and snipping capabilities.',
      features: ['Text extraction from images', 'Snipping tool integration', 'Multi-language support'],
    },
    {
      animation: animation3,
      title: 'Forest Fire Modelling',
      content: 'Data Science Project',
      description: 'A series of models designed to examine which factors predispose areas to forest fires most.',
      features: [
        'Analyzed causes of spread rates',
        'Determined the most predictive factor extractable from public data to be humidity',
        'Discovered weather to be a surprisingly poor predictor of forest fires - likely due to data chunking',
      ],
    },
    {
      animation: animation4,
      title: '3D Game of Life',
      content: 'Scroll up :P',
      description: 'A 3D implementation of the classic cellular automaton.',
      features: ['Stores previous cycles on the y-axis', 'Real-time 3D rendering', 'Shows how the game evolves over time'],
    },
  ];

  return (
    <div className="bg-dark pt-32 min-h-screen">
      <div className="text-center">
        <h2 className="text-8xl font-bold text-white mb-12">MY PROJECTS</h2>
      </div>
      <div className="grid grid-cols-2 gap-8 w-2/4 px-4 mt-2 mx-auto">
        {tiles.map((tile, index) => (
          <div
            key={index}
            className="bg-gray-900 rounded-lg shadow-md cursor-pointer relative transition duration-300 ease-in-out transform hover:scale-105"
            onClick={() => handleTileClick(index)}
          >
            {revealedTiles.includes(index) ? (
              <div className="p-6">
                <h3 className="text-2xl font-bold text-center mb-2">{tile.title}</h3>
                <p className="text-center text-gray-300 mb-4">{tile.content}</p>
                <p className="mb-4">{tile.description}</p>
                <ul className="list-disc pl-6">
                  {tile.features.map((feature, idx) => (
                    <li key={idx}>{feature}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <Lottie
                  options={{
                    loop: true,
                    autoplay: true,
                    animationData: tile.animation,
                    rendererSettings: {
                      preserveAspectRatio: 'xMidYMid slice',
                    },
                  }}
                  height={300}
                  width={300}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <h3 className="inline-block bg-black bg-opacity-50 text-white text-xl font-bold py-2 px-4 rounded-full backdrop-filter backdrop-blur-md">
                    {tile.title}
                  </h3>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TileGrid;