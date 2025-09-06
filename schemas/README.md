# Schemas

JSON Schemas for the ingest endpoints. Example Logstash configuration to POST events:

```
output {
  http {
    url => "http://localhost:8080/ingest/channel-events"
    http_method => "post"
    format => "json"
    headers => ["x-api-key", "INGEST_KEY"]
  }
}
```
