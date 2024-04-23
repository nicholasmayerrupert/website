import GameOfLife3D from './GameOfLife3D';

const Hero = () => {
    return (
        <div className="relative flex flex-1 overflow-hidden h-screen">
            {/* Text overlay positioned on the left side of the screen */}
            <div className="w-1/3 flex flex-col justify-start text-white pl-48 pt-48 break-keep">
                <h1 className="text-8xl font-bold mb-4 whitespace-nowrap">
                    NICHOLAS <br /> MAYER-RUPERT
                </h1>
                <p className="text-3xl ml-16">
                    COMPUTER SCIENCE STUDENT AT SFU. SOFTWARE ENGINEERING ENJOYER.
                </p>
            </div>

            {/* GameOfLife3D positioned more to the left but independently from the text */}
            <div className="w-1/2 relative">
                <GameOfLife3D className="absolute top-0 left-0 w-full h-full object-cover" />
            </div>

            {/* Gradient at the bottom across the whole screen */}
            <div className="absolute bottom-0 left-0 w-full h-1/6 bg-gradient-to-t from-[#121212] to-transparent"></div>
            <div className="absolute top-0 left-0 w-full h-1/6 bg-gradient-to-t from-transparent to-[#121212]"></div>
        </div>
    )
};

export default Hero;
