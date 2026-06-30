import React from 'react';
import GameOfLife3D from './GameOfLife3D';

/* -------------------- PAGE -------------------- */
export default function About() {
  return (
    <section className="relative overflow-hidden bg-dark">
      {/* Content */}
      <div className="relative z-[1] mx-auto max-w-[96rem] px-4 sm:px-6 pt-12 sm:pt-6 pb-48">
        <h2 className="text-white font-bold tracking-tight text-center text-3xl sm:text-5xl md:text-6xl">
          SKILLS & <br className="hidden sm:block" /> EXPERIENCE
        </h2>

        <div className="mt-8 grid grid-cols-1 gap-5 xl:min-h-[44rem] xl:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)] xl:grid-rows-2 xl:items-stretch">
          {/* Experience */}
          <div className="flex min-h-[18rem] w-full overflow-auto rounded-xl bg-gray-900/90 p-4 shadow-lg ring-1 ring-white/15 sm:p-5 xl:col-start-1 xl:row-start-1 xl:min-h-0">
            <pre className="grow whitespace-pre-wrap break-words text-left font-mono text-xs leading-6 text-white [word-break:break-word] sm:text-sm xl:text-xs">
              <code>
                <span className="text-blue-400">// Internship experience</span>{'\n'}
                <span className="text-red-500">const</span> <span className="text-purple-300">connectionLab</span> {'= {'}{'\n'}
                {'    '}<span className="text-yellow-500">role</span>{": '"}<span className="text-green-500">Full-Stack Developer Intern</span>{"',"}{'\n'}
                {'    '}<span className="text-yellow-500">stack</span>{': {'}{'\n'}
                {'        '}<span className="text-yellow-500">frontend</span>{": ['"}<span className="text-green-500">JavaScript</span>{"', '"}<span className="text-green-500">Handlebars</span>{"'],"}{'\n'}
                {'        '}<span className="text-yellow-500">backend</span>{": ['"}<span className="text-green-500">Node.js</span>{"'],"}{'\n'}
                {'        '}<span className="text-yellow-500">database</span>{": ['"}<span className="text-green-500">SQL</span>{"']"}{'\n'}
                {'    '}{'},'}{'\n'}
                {'    '}<span className="text-yellow-500">contributions</span>{": ["}{'\n'}
                {'        '}{"\""}<span className="text-green-500">Built a production website end-to-end (frontend & backend)</span>{"\","}{'\n'}
                {'        '}{"\""}<span className="text-green-500">Designed REST APIs and integrated client-side views</span>{"\","}{'\n'}
                {'        '}{"\""}<span className="text-green-500">Managed migrations and optimized queries</span>{"\","}{'\n'}
                {'        '}{"\""}<span className="text-green-500">Implemented auth, validation, and robust error handling</span>{"\""}{'\n'}
                {'    '}{"]"}{'\n'}
                {'}'}{';'}{'\n'}
              </code>
            </pre>
          </div>

          <div className="h-[34rem] overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] shadow-2xl md:h-[38rem] xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:h-full xl:min-h-[44rem]">
            <GameOfLife3D className="h-full w-full" />
          </div>

          {/* Tech stack */}
          <div className="flex min-h-[18rem] w-full overflow-auto rounded-xl bg-gray-900/90 p-4 shadow-lg ring-1 ring-white/15 sm:p-5 xl:col-start-1 xl:row-start-2 xl:min-h-0">
            <pre className="grow whitespace-pre-wrap break-words text-left font-mono text-xs leading-6 text-white [word-break:break-word] sm:text-sm xl:text-xs">
              <code>
                <span className="text-blue-400">// Languages + back-end profile</span>{'\n'}
                <span className="text-red-500">const</span> <span className="text-purple-300">techStack</span> {'= {'}{'\n'}
                {'    '}<span className="text-yellow-500">languages</span>{": ['"}
                <span className="text-green-500">C++</span>{"', '"}
                <span className="text-green-500">Python</span>{"', '"}
                <span className="text-green-500">JavaScript (ES6+)</span>{"', '"}
                <span className="text-green-500">SQL</span>{"'],"}{'\n'}
                {'    '}<span className="text-yellow-500">backend</span>{': {'}{'\n'}
                {'        '}<span className="text-yellow-500">strengths</span>{": ['"}
                <span className="text-green-500">REST APIs</span>{"', '"}
                <span className="text-green-500">Auth/sessions</span>{"', '"}
                <span className="text-green-500">Schema design</span>{"'],"}{'\n'}
                {'        '}<span className="text-yellow-500">summary</span>{": '"}
                <span className="text-green-500">Builds secure, documented services.</span>{"'"}{'\n'}
                {'    '}{'},'}{'\n'}
                {'    '}<span className="text-yellow-500">databases</span>{": ['"}
                <span className="text-green-500">PostgreSQL</span>{"', '"}
                <span className="text-green-500">MySQL</span>{"'],"}{'\n'}
                {'    '}<span className="text-yellow-500">tools</span>{": ['"}
                <span className="text-green-500">Git</span>{"', '"}
                <span className="text-green-500">Node.js</span>{"', '"}
                <span className="text-green-500">Vite</span>{"']"}{'\n'}
                {'}'}{';'}{'\n'}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
