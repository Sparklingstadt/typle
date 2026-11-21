# The answers of src/server/response.ts: JSON.stringify plus a newline, never cached, varying by Cookie.
class ApplicationController < ActionController::API
  private

  def reply(status, value)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Cookie"
    render body: Typle::JsonValue.generate(value) + "\n", status: status, content_type: "application/json; charset=utf-8"
  end

  def refuse(status, key)
    reply(status, { "error" => key })
  end
end
