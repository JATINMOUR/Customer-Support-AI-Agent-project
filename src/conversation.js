const { randomUUID } = require('node:crypto');


const FOLLOW_UP_PATTERN =
  /^(what about|how about|and |when (will|does|is)|where (is|are)|what (is|are) (it|that|they)|does (it|that)|can (it|that)|will (it|that)|that|it|they)\b/i;

const SUBJECT_TERMS =
  /\b(ORD[-\s_]?\d{4}|canada|international|ship(?:ping)?|return(?:s|ed|ing)?|warranty|breeze tumbler|tumbler|final[- ]sale|damaged|refund|cancel(?:led|lation)?|deliver(?:y|ed)?|arrival|order)\b/gi;



// Subject Normalization


function normalizeSubject(value) {
  const term = value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');


  if (/^ord\d{4}$/.test(term)) {
    return term.toUpperCase();
  }


  if (
    /^(ship|shipping|international)$/.test(term)
  ) {
    return 'shipping';
  }


  if (
    /^(return|returns|returned|returning)$/.test(term)
  ) {
    return 'returns';
  }


  if (
    /^(deliver|delivery|delivered|arrival)$/.test(term)
  ) {
    return 'delivery';
  }


  if (
    /^(cancel|cancelled|cancellation)$/.test(term)
  ) {
    return 'cancellation';
  }


  return term;
}



// Extract Subjects


function subjectsFor(message) {
  return [
    ...message.matchAll(SUBJECT_TERMS)
  ].map((match) =>
    normalizeSubject(match[0])
  );
}



// Detect Follow-Up Question


function isFollowUp(message) {
  return FOLLOW_UP_PATTERN.test(
    message.trim()
  );
}



// Conversation Session


class ConversationSession {
  constructor(
    id = randomUUID(),
    { maxTurns = 8 } = {}
  ) {
    this.id = id;
    this.maxTurns = maxTurns;
    this.turns = [];
  }


  // ----------------------------------------------------------
  // Add User Message
  // ----------------------------------------------------------

  addUserMessage(content) {
    const turn = {
      role: 'user',
      content,
      subjects: subjectsFor(content),
      createdAt: new Date().toISOString()
    };


    this.turns.push(turn);

    this.trim();

    return turn;
  }


  // ----------------------------------------------------------
  // Add Assistant Message
  // ----------------------------------------------------------

  addAssistantMessage(
    content,
    { subjects = [] } = {}
  ) {
    this.turns.push({
      role: 'assistant',
      content,
      subjects,
      createdAt: new Date().toISOString()
    });


    this.trim();
  }


  // ----------------------------------------------------------
  // Get Relevant Conversation History
  // ----------------------------------------------------------

  relevantHistory(nextMessage) {
    const nextSubjects = new Set(
      subjectsFor(nextMessage)
    );

    const followUp =
      isFollowUp(nextMessage);

    const userTurns = this.turns.filter(
      (turn) => turn.role === 'user'
    );


    if (
      !followUp &&
      nextSubjects.size === 0
    ) {
      return [];
    }


    let anchorIndex = -1;


    for (
      let index = this.turns.length - 1;
      index >= 0;
      index -= 1
    ) {
      const turn = this.turns[index];

      const sharesSubject =
        turn.subjects.some(
          (subject) =>
            nextSubjects.has(subject)
        );


      if (
        sharesSubject ||
        (followUp && turn.role === 'user')
      ) {
        anchorIndex = index;
        break;
      }
    }


    if (
      anchorIndex < 0 ||
      userTurns.length === 0
    ) {
      return [];
    }


    // Include only the immediately relevant
    // exchange, never the entire transcript.

    return this.turns
      .slice(
        anchorIndex,
        Math.min(
          anchorIndex + 2,
          this.turns.length
        )
      )
      .map(
        ({
          role,
          content,
          subjects
        }) => ({
          role,
          content,
          subjects
        })
      );
  }


  // ----------------------------------------------------------
  // Trim Old Turns
  // ----------------------------------------------------------

  trim() {
    if (
      this.turns.length >
      this.maxTurns
    ) {
      this.turns.splice(
        0,
        this.turns.length -
          this.maxTurns
      );
    }
  }
}



// Session Store


class SessionStore {
  constructor({
    maxSessions = 100,
    maxTurns = 8
  } = {}) {
    this.maxSessions = maxSessions;
    this.maxTurns = maxTurns;
    this.sessions = new Map();
  }


  // ----------------------------------------------------------
  // Get Existing Session
  // ----------------------------------------------------------

  get(id) {
    if (!id) {
      return this.create();
    }


    if (!this.sessions.has(id)) {
      this.sessions.set(
        id,
        new ConversationSession(id, {
          maxTurns: this.maxTurns
        })
      );
    }


    return this.sessions.get(id);
  }


  // ----------------------------------------------------------
  // Create New Session
  // ----------------------------------------------------------

  create() {
    const session =
      new ConversationSession(
        undefined,
        {
          maxTurns: this.maxTurns
        }
      );


    if (
      this.sessions.size >=
      this.maxSessions
    ) {
      this.sessions.delete(
        this.sessions.keys().next().value
      );
    }


    this.sessions.set(
      session.id,
      session
    );


    return session;
  }
}



// Exports


module.exports = {
  ConversationSession,
  SessionStore,
  subjectsFor,
  isFollowUp
};