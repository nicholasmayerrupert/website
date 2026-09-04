import { Fragment } from 'react';

const SplitText = ({ text, className = '' }) => {
  let letterIndex = 0;

  return (
    <h1 className={`split-parent ${className}`} aria-label={text}>
      <span aria-hidden="true">
        {text.split(' ').map((word, wordIndex) => (
          <Fragment key={wordIndex}>
            {wordIndex > 0 && ' '}
            <span className="split-word">
              {[...word].map((letter, index) => (
                <span
                  key={index}
                  className="split-char"
                  style={{ animationDelay: `${letterIndex++ * 30}ms` }}
                >
                  {letter}
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </h1>
  );
};

export default SplitText;
