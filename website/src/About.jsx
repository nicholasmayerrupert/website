import React from 'react';
import Lottie from 'react-lottie';
import animationData from './laptop.json';

const About = () => {
    const defaultOptions = {
        loop: true,
        autoplay: true, 
        animationData: animationData,
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid slice' 
        }
      };
  return (
    <div className="pt-48 pb-4 bg-dark flex">
      {/* Lottie animation container */}
      <div className="w-1/2 flex justify-center items-center">
        <div style = {{ transform: 'scaleX(-1)' }}>
        <Lottie options={defaultOptions} height={650} width={650} />
      </div></div>

      {/* Right-aligned Text Sections */}
      <div className="w-1/2">
        <h2 className="text-8xl font-bold text-white text-right mr-72 whitespace-break-spaces break-normal max-w-screen-lg">SKILLS &    <br></br>EXPERIENCE</h2>

        {/* Programming Languages Section */}
        <div className="mt-8 mr-32 max-w-4xl bg-gray-900 rounded-lg p-6 shadow-lg">
          <pre className="text-base sm:text-lg text-left text-white">
            <code>
              <span className="text-blue-400">// Define a dictionary with the languages I know</span>{'\n'}
              <span className="text-red-500">const</span> <span className="text-purple-300">programmingLanguages</span> = {'{\n'}
              <span className="text-yellow-500">    languages</span>: ['<span className="text-green-500">C++</span>', '<span className="text-green-500">Python</span>', '<span className="text-green-500">Java</span>'],{'\n'}
              {'};'}{'\n'}
            </code>
          </pre>
        </div>

        {/* Frameworks and Libraries Section */}
        <div className="mt-8 mr-32 max-w-4xl bg-gray-900 rounded-lg p-6 shadow-lg">
          <pre className="text-base sm:text-lg text-left text-white">
            <code>
              <span className="text-blue-400">// Frameworks and libraries I've worked with</span>{'\n'}
              <span className="text-red-500">const</span> <span className="text-purple-300">frameworksAndLibraries</span> = {'{\n'}
              <span className="text-yellow-500">    frameworks</span>: ['<span className="text-green-500">React</span>', '<span className="text-green-500">Node.js</span>'],{'\n'}
              <span className="text-yellow-500">    libraries</span>: ['<span className="text-green-500">Pandas</span>','<span className="text-green-500">Matplotlib</span>','<span className="text-green-500">NumPy</span>', '<span className="text-green-500">OpenCV</span>'],{'\n'}
              {'};'}{'\n'}
            </code>
          </pre>
        </div>

        {/* Additional Skills Section */}
        <div className="mt-8 mr-32 max-w-4xl bg-gray-900 rounded-lg p-6 shadow-lg">
          <pre className="text-base sm:text-lg text-left text-white">
            <code>
              <span className="text-blue-400">// Additional skills I've developed</span>{'\n'}
              <span className="text-red-500">const</span> <span className="text-purple-300">additionals</span> = ['<span className="text-green-500">Chess</span>', '<span className="text-green-500">Pixel Art</span>', '<span className="text-green-500">Data Science</span>'];{'\n'}
            </code>
          </pre>
        </div>     

      </div>           


    </div>
  );
};

export default About;
