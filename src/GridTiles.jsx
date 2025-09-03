import React, { useState } from 'react';
import image1 from './chess.png';
import image2 from './grabby.png';
import image3 from './forestfire.png';
import image4 from './gameoflife.jpg';

function Modal({ project, onClose }) {
    const handleClickOutside = (event) => {
        if (event.target.id === "modal-backdrop") {
            onClose();
        }
    };

    return (
        <div id="modal-backdrop" className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center" onClick={handleClickOutside}>
            <div className="bg-dark p-6 bg-opacity-75 backdrop-blur rounded-lg shadow-lg max-w-lg max-h-screen overflow-auto">
                <div className="mt-4">
                    <h3 className="text-2xl font-bold mb-4 text-white">{project.title}</h3>
                    <p className="text-lg text-white">{project.content}</p>
                    <div className="mt-6">
                        <p className="text-white">{project.description}</p>
                        <ul className="list-disc list-inside mt-4 text-white">
                            {project.features.map((feature, index) => (
                                <li key={index}>{feature}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

const GridTiles = () => {
    const [selectedProject, setSelectedProject] = useState(null);

    const projects = [
        {
            img: image1,
            title: 'Chess Engine',
            content: 'Software Project',
            description: 'A decent chess engine built using C++.',
            features: ['AI opponent from terminal', 'Move analysis', 'Plays at ~1200 ELO']
        },
        {
            img: image2,
            title: 'Grabby - OCR + Snipping Tool',
            content: 'Software Project',
            description: 'A versatile tool combining OCR and snipping capabilities.',
            features: ['Text extraction from images', 'Snipping tool integration', 'Multi-language support']
        },
        {
            img: image3,
            title: 'Forest Fire Modelling',
            content: 'Data Science Project',
            description: 'A series of models designed to examine which factors predispose areas to forest fires most.',
            features: ['Analyzed causes of spread rates', 'Determined the most predictive factor extractable from public data to be humidity', 'Discovered weather to be a surprisingly poor predictor of forest fires - likely due to data chunking']
        },
        {
            img: image4,
            title: '3D Game of Life',
            content: 'Scroll up :P',
            description: 'A 3D implementation of the classic cellular automaton.',
            features: ['Stores previous cycles on the y-axis', 'Real-time 3D rendering', 'Shows how the game evolves over time']
        }
    ];

    const handleProjectClick = (project) => {
        setSelectedProject(project);
    };

    const handleCloseModal = () => {
        setSelectedProject(null);
    };

    return (
        <div className="bg-dark grid grid-cols-1 items-center justify-items-center h-screen">
            <h2 className="text-8xl font-bold text-white mt-32 text-center col-span-full">MY PROJECTS</h2>
            <div className="grid grid-cols-2 gap-8 w-2/4 px-4 mt-24">
                {projects.map((project, index) => (
                    <div key={index} className="transition-transform hover:scale-105 hover:-translate-y-2"
                         onClick={() => handleProjectClick(project)}>
                        <div style={{ backgroundImage: `url(${project.img})` }} className="bg-cover bg-center rounded-lg h-72 w-full flex items-center justify-center">
                            <div className="bg-black bg-opacity-40 backdrop-blur rounded-full px-2 py-1">
                                <span className="text-white text-3xl font-semibold">{project.title}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {selectedProject && (
                <Modal project={selectedProject} onClose={handleCloseModal} />
            )}
        </div>
    );
};

export default GridTiles;