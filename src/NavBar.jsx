import React from 'react';

const NavBar = () => {
  return (
    <div className="fixed top-0 left-0 right-0 mx-auto w-1/4 max-w-screen-lg bg-black bg-opacity-0 backdrop-blur text-white z-50 rounded-b-lg">
      <div className="flex justify-center items-center py-4">
        <a className="px-4 py-2 group text-white hover:text-gray-300" href="#home">
          HOME
          <div className="bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"></div>
        </a>
        <a className="px-4 py-2 group text-white hover:text-gray-300" href="#skills">
          SKILLS
          <div className="bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"></div>
        </a>
        <a className="px-4 py-2 group text-white hover:text-gray-300" href="#projects">
          PROJECTS
          <div className="bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"></div>
        </a>
        <a className="px-4 py-2 group text-white hover:text-gray-300" href="#contact">
          CONTACT
          <div className="bg-gray-500 h-[2px] w-0 group-hover:w-full transition-all duration-500"></div>
        </a>
      </div>
    </div>
  );
};

export default NavBar;