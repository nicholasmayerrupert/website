import React from 'react';
import { FaGithub, FaLinkedin } from 'react-icons/fa';

const Contact = () => {
    const contactItems = [
        {
            icon: <FaGithub className="text-4xl" />,
            label: 'GitHub',
            link: 'https://github.com/nicholasmayerrupert',
        },
        {
            icon: <FaLinkedin className="text-4xl" />,
            label: 'LinkedIn',
            link: 'https://www.linkedin.com/in/nicholas-mayer-rupert/',
        },
    ];

    return (
        <div className="pt-16 bg-dark py-12">
            <div className="container mx-auto">
                <h2 className="text-4xl font-bold mb-8 text-center text-white">Contact Me :D</h2>
                <div className="flex justify-center">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                        {contactItems.map((item, index) => (
                            <a
                                key={index}
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-gray-900 rounded-lg shadow-md p-6 flex flex-col items-center hover:bg-gray-800 transition duration-300"
                            >
                                <div className="text-blue-600 mb-4">{item.icon}</div>
                                <h3 className="text-xl font-semibold text-white">{item.label}</h3>
                            </a>
                        ))}
                    </div>
                </div>
                <div className="mt-8 text-center">
                    <p className="text-white">Email: njmrme@gmail.com</p>
                </div>
            </div>
        </div>
    );
};

export default Contact;