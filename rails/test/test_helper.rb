ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "minitest/mock"

module ActiveSupport
  class TestCase
    # The DB tests check the rows other connections leave (two saves at once), so no test runs in a transaction.
    self.use_transactional_tests = false

    # Sets the environment variables for the block and puts them back afterwards.
    def with_env(values)
      saved = values.keys.to_h { |key| [key, ENV[key]] }
      values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
      yield
    ensure
      saved.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    end
  end
end
