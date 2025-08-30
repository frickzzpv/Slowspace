import { render, screen } from '@testing-library/react'
import Home from './page'

// Mock the game component to avoid rendering the whole game in a unit test
jest.mock('@/components/PaperDriftGame', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return function DummyPaperDriftGame() {
    return (
      React.createElement('div', null,
        React.createElement('h1', null, 'Paper Drift'),
        React.createElement('button', null, 'Start Game')
      )
    );
  }
});

describe('Home Page', () => {
  it('renders the main game component', () => {
    render(<Home />)

    // Check for a heading and button from our mock component
    const heading = screen.getByRole('heading', { name: /paper drift/i });
    const button = screen.getByRole('button', { name: /start game/i });

    expect(heading).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  })
})
