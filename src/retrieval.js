const fs = require('node:fs');
const path = require('node:path');



// Constants


const TOKEN_RE =
  /[a-z0-9]+(?:-[a-z0-9]+)*/gi;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'do',
  'for',
  'how',
  'i',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'when',
  'will',
  'with',
  'you',
  'your'
]);



// Parse Markdown Front Matter


function parseFrontMatter(markdown) {
  const match = markdown.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
  );


  if (!match) {
    return {
      attributes: {},
      body: markdown
    };
  }


  const attributes = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .flatMap((line) => {
        const colon = line.indexOf(':');

        if (colon < 1) {
          return [];
        }


        const key = line
          .slice(0, colon)
          .trim();

        const value = line
          .slice(colon + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');


        return [
          [
            key,
            value === 'true'
              ? true
              : value === 'false'
                ? false
                : value
          ]
        ];
      })
  );


  return {
    attributes,
    body: markdown.slice(match[0].length)
  };
}



// Tokenization


function tokenize(value) {
  const aliases = {
    regular: 'standard',
    backpack: 'bags',
    backpacker: 'bags'
  };


  return (
    value
      .toLowerCase()
      .match(TOKEN_RE) || []
  )
    .map(
      (word) =>
        stem(aliases[word] || word)
    )
    .filter(
      (word) =>
        !STOP_WORDS.has(word)
    );
}



// Word Stemming


// Small deterministic normalization is deliberately used
// instead of a model so that common phrasing changes
// ("covered"/"covers", "return"/"returns") do not change
// source selection unpredictably.

function stem(word) {
  if (
    word.endsWith('ies') &&
    word.length > 4
  ) {
    return `${word.slice(0, -3)}y`;
  }


  if (
    word.endsWith('ing') &&
    word.length > 5
  ) {
    return word.slice(0, -3);
  }


  if (
    word.endsWith('ed') &&
    word.length > 4
  ) {
    return word.slice(0, -2);
  }


  if (
    word.endsWith('es') &&
    word.length > 4
  ) {
    return word.slice(0, -2);
  }


  if (
    word.endsWith('s') &&
    word.length > 3
  ) {
    return word.slice(0, -1);
  }


  return word;
}



// Split Markdown into Sections


function splitSections(body) {
  const lines = body
    .replace(/\r/g, '')
    .split('\n');


  let title = 'Document';
  let heading = title;
  let buffer = [];
  const sections = [];


  const flush = () => {
    const text = buffer
      .join('\n')
      .trim();


    if (text) {
      sections.push({
        heading,
        text
      });
    }


    buffer = [];
  };


  for (const line of lines) {
    const headingMatch =
      line.match(
        /^(#{1,3})\s+(.+)$/
      );


    if (!headingMatch) {
      buffer.push(line);
      continue;
    }


    flush();


    if (
      headingMatch[1].length === 1
    ) {
      title =
        headingMatch[2].trim();
    }


    heading =
      headingMatch[2].trim() ||
      title;
  }


  flush();


  return sections.length
    ? sections
    : [
        {
          heading: title,
          text: body.trim()
        }
      ];
}



// Authority Ranking


function authorityRank(metadata) {
  if (metadata.status !== 'active') {
    return 0;
  }


  if (metadata.audience !== 'customer') {
    return 0;
  }


  return metadata.policy_authority ===
    'official'
    ? 3
    : 1;
}



// Load Knowledge Base


function loadKnowledgeBase(directory) {
  const documents = fs
    .readdirSync(directory)
    .filter((file) =>
      file.endsWith('.md')
    )
    .sort()
    .map((filename) => {

      const parsed =
        parseFrontMatter(
          fs.readFileSync(
            path.join(
              directory,
              filename
            ),
            'utf8'
          )
        );


      return {
        filename,
        metadata: parsed.attributes,
        sections: splitSections(
          parsed.body
        )
      };
    });


  const chunks = documents.flatMap(
    (document) =>
      document.sections.map(
        (section, index) => ({
          id: `${document.filename}#${index + 1}`,
          filename: document.filename,
          heading: section.heading,
          text: section.text,
          metadata: document.metadata,
          authorityRank:
            authorityRank(
              document.metadata
            ),
          titleTerms: tokenize(
            document.metadata.title ||
              ''
          ),
          terms: tokenize(
            `${document.metadata.title || ''} ` +
            `${section.heading} ` +
            `${section.text}`
          )
        })
      )
  );


  return {
    documents,
    chunks
  };
}



// Create Retriever


function createRetriever(directory) {
  const index =
    loadKnowledgeBase(directory);


  // ----------------------------------------------------------
  // Calculate Document Frequency
  // ----------------------------------------------------------

  const documentFrequency =
    new Map();


  for (
    const chunk of index.chunks
  ) {
    for (
      const word of new Set(chunk.terms)
    ) {
      documentFrequency.set(
        word,
        (
          documentFrequency.get(word) ||
          0
        ) + 1
      );
    }
  }


  // ----------------------------------------------------------
  // Search Knowledge Base
  // ----------------------------------------------------------

  function search(
    query,
    {
      limit = 4,
      includeNonAuthoritative = false
    } = {}
  ) {

    const queryTerms =
      tokenize(query);


    const candidates =
      index.chunks.filter(
        (chunk) =>
          includeNonAuthoritative ||
          chunk.authorityRank > 0
      );


    const total =
      candidates.length || 1;


    return candidates
      .map((chunk) => {

        const counts = new Map();


        for (
          const word of chunk.terms
        ) {
          counts.set(
            word,
            (
              counts.get(word) ||
              0
            ) + 1
          );
        }


        let lexicalScore = 0;


        for (
          const word of queryTerms
        ) {
          if (!counts.has(word)) {
            continue;
          }


          lexicalScore +=
            (
              1 +
              Math.log(
                counts.get(word)
              )
            ) *
            (
              Math.log(
                (total + 1) /
                (
                  (
                    documentFrequency.get(
                      word
                    ) || 0
                  ) + 1
                )
              ) + 1
            );
        }


        const titleMatches =
          queryTerms.filter(
            (word) =>
              chunk.titleTerms.includes(
                word
              )
          ).length;


        lexicalScore +=
          titleMatches * 3;


        // Official active content is a tie-breaker,
        // not a substitute for relevance.

        const score =
          lexicalScore +
          (
            lexicalScore > 0
              ? chunk.authorityRank *
                0.08
              : 0
          );


        return {
          ...chunk,
          score: Number(
            score.toFixed(4)
          )
        };
      })
      .filter(
        (chunk) =>
          chunk.score > 0
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.authorityRank -
            a.authorityRank ||
          a.filename.localeCompare(
            b.filename
          )
      )
      .slice(0, limit);
  }


  // ----------------------------------------------------------
  // Detect Conflicting Sources
  // ----------------------------------------------------------

  function findConflicts(
    query,
    passages = search(
      query,
      { limit: 8 }
    )
  ) {

    const text = passages
      .map((p) => p.text.toLowerCase())
      .join('\n');


    const hasHandWash =
      /hand[- ]wash/.test(text);

    const hasDishwasherSafe =
      /dishwasher safe/.test(text);


    if (
      hasHandWash &&
      hasDishwasherSafe
    ) {
      const sources =
        passages.filter(
          (p) =>
            /hand[- ]wash|dishwasher safe/i.test(
              p.text
            )
        );


      const distinct = [
        ...new Map(
          sources.map(
            (p) => [
              p.filename,
              p
            ]
          )
        ).values()
      ];


      if (distinct.length > 1) {
        return [
          {
            topic:
              'dishwasher care',

            passages:
              distinct.map(
                toPublicPassage
              ),

            guidance:
              'Current official sources conflict. Do not choose one silently; recommend human confirmation and the safest interim guidance.'
          }
        ];
      }
    }


    return [];
  }


  // ----------------------------------------------------------
  // Retriever API
  // ----------------------------------------------------------

  return {
    ...index,
    search,
    findConflicts
  };
}



// Convert Passage to Public Format


function toPublicPassage(passage) {
  return {
    source:
      `${passage.filename} — ${passage.heading}`,

    filename:
      passage.filename,

    heading:
      passage.heading,

    text:
      passage.text,

    score:
      passage.score,

    metadata: {
      document_id:
        passage.metadata.document_id,

      title:
        passage.metadata.title,

      status:
        passage.metadata.status,

      audience:
        passage.metadata.audience,

      policy_authority:
        passage.metadata.policy_authority
    }
  };
}



// Exports


module.exports = {
  parseFrontMatter,
  splitSections,
  loadKnowledgeBase,
  createRetriever,
  toPublicPassage
};