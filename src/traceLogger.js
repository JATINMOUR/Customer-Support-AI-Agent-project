
// Redact Sensitive Information


function redact(value) {
  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(redact);
  }


  // Handle objects
  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/email|address|customer|internal|risk|secret|prompt/i.test(
              key
            )
        )
        .map(
          ([key, nested]) => [
            key,
            redact(nested)
          ]
        )
    );
  }


  // Primitive values
  return value;
}



// Trace Logger


class TraceLogger {
  constructor({
    enabled = false,
    write
  } = {}) {
    this.enabled = enabled;

    this.write =
      write ||
      ((entry) =>
        process.stderr.write(
          `${JSON.stringify(entry)}\n`
        ));
  }


  // ----------------------------------------------------------
  // Log Agent Response
  // ----------------------------------------------------------

  log(response) {
    if (!this.enabled) {
      return;
    }


    const trace =
      response.trace || {};


    const logEntry = {
      event:
        'support_agent_response',

      timestamp:
        new Date().toISOString(),

      session_id:
        response.session_id,

      user_message:
        trace.user_message,

      relevant_history:
        trace.relevant_history,

      retrieved_passages:
        trace.retrieved_passages,

      tool_call:
        trace.tool_call,

      final_response:
        response.answer,

      handoff:
        response.handoff,

      errors_or_fallbacks:
        response.handoff
          ? ['human_handoff_recommended']
          : []
    };


    this.write(
      redact(logEntry)
    );
  }
}



// Exports


module.exports = {
  TraceLogger,
  redact
};