module Typle
  # JSON as JSON.parse and JSON.stringify treat it (filled in by the JS-compatibility task).
  module JsonValue
    module_function

    def generate(value)
      JSON.generate(value)
    end
  end
end
