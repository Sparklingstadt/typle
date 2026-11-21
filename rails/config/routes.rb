Rails.application.routes.draw do
  scope "/api" do
    # GET routes answer HEAD too (Rails runs them and drops the body).
    get "health", to: "errors#not_found"
    match "health", to: "errors#method_not_allowed", via: :all, defaults: { allow: "GET, HEAD" }

    get "workspace", to: "errors#not_found"
    put "workspace", to: "errors#not_found"
    match "workspace", to: "errors#method_not_allowed", via: :all, defaults: { allow: "GET, HEAD, PUT" }

    post "workspace/records", to: "errors#not_found"
    delete "workspace/records", to: "errors#not_found"
    match "workspace/records", to: "errors#method_not_allowed", via: :all, defaults: { allow: "POST, DELETE" }
  end

  root to: "errors#not_found", via: :all
  match "*path", to: "errors#not_found", via: :all, format: false
end
