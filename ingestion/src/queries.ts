export const LIST_ALERTS = `
query ListAlerts($input: AlertQueryInput!) {
  listAlerts(input: $input) {
    items {
      uuid
      id
      created
      updated
      received
      eventTimestamp
      status
      severity
      eventType
      actions
      tags
      json
      computer { uuid }
      plan { id name }
    }
    pageInfo { next total }
  }
}
`;

export const LIST_COMPUTERS = `
query ListComputers($input: ComputerQueryInput) {
  listComputers(input: $input) {
    items {
      uuid
      serial
      hostName
      osString
      modelName
      version
      created
      updated
      connectionStatus
      lastConnection
      lastConnectionIp
      webProtectionActive
      fullDiskAccess
      insightsStatsPass
      insightsStatsFail
      insightsStatsUnknown
      insightsUpdated
      tags
      plan { id name }
      scorecard {
        uuid
        label
        section
        pass
        enabled
        tags
      }
    }
    pageInfo { next total }
  }
}
`;
