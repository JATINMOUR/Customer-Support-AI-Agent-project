#!/usr/bin/env node

const readline = require('node:readline');

const { SupportAgent } = require('./agent');


function renderResponse(response) {
  const lines = [
    `\n${response.answer}`
  ];


  if (response.sources.length) {
    lines.push('\nSources:');

    for (const source of response.sources) {
      lines.push(`- ${source}`);
    }
  }


  if (response.handoff) {
    lines.push('\nHuman handoff recommended.');
  }


  return lines.join('\n');
}


function startCli({
  input = process.stdin,
  output = process.stdout,
  debug = process.argv.includes('--debug')
} = {}) {

  const agent = new SupportAgent({
    debug
  });


  const session = agent.sessions.create();


  const prompt = () => {
    output.write('\nYou: ');
  };


  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(
      input.isTTY &&
      output.isTTY
    )
  });


  output.write(
    'Aster & Row Support Agent\n' +
    'Ask about policies or an order. ' +
    'Type exit to finish.\n'
  );


  prompt();


  rl.on('line', (line) => {
    const message = line.trim();


    if (!message) {
      return prompt();
    }


    if (/^(exit|quit)$/i.test(message)) {
      output.write('Goodbye.\n');
      return rl.close();
    }


    const response = agent.respond({
      sessionId: session.id,
      message
    });


    output.write(
      `${renderResponse(response)}\n`
    );


    prompt();
  });


  return rl;
}


if (require.main === module) {
  startCli();
}


module.exports = {
  renderResponse,
  startCli
};