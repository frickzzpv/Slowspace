import React from 'react';
import { render, screen } from '@testing-library/react';
import PaperDriftGame from '../PaperDriftGame';

// Mock Tone.js
jest.mock('tone', () => {
  return {
    Synth: jest.fn().mockImplementation(() => ({
      toDestination: jest.fn().mockReturnThis(),
      triggerAttackRelease: jest.fn(),
    })),
    NoiseSynth: jest.fn().mockImplementation(() => ({
      toDestination: jest.fn().mockReturnThis(),
      triggerAttackRelease: jest.fn(),
    })),
    start: jest.fn(),
    now: jest.fn(),
  };
});

// Mock dynamic import for client components
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (func) => {
    const Component = func();
    return Component;
  },
}));

describe('PaperDriftGame', () => {
  it('should render the start screen when the game has not started', () => {
    render(<PaperDriftGame />);

    // Check for the main title
    const titleElement = screen.getByText(/Paper Drift: Gravity Flip/i);
    expect(titleElement).toBeInTheDocument();

    // Check for the controls section
    const controlsTitle = screen.getByText(/Controls/i);
    expect(controlsTitle).toBeInTheDocument();

    // Check for the start button
    const startButton = screen.getByRole('button', { name: /Start Game/i });
    expect(startButton).toBeInTheDocument();
  });
});
