export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      affiliate_clicks: {
        Row: {
          buyer_country: string | null
          click_id: string
          commission_amount: number | null
          commission_currency: string | null
          commission_gbp: number | null
          converted_at: string | null
          created_at: string
          merchant_id: string | null
          monetised_url: string
          provider: string
          provider_subid: string | null
          raw_url: string
          recipient_country: string | null
          recipient_id: string | null
          recommendation_id: string | null
          session_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          buyer_country?: string | null
          click_id?: string
          commission_amount?: number | null
          commission_currency?: string | null
          commission_gbp?: number | null
          converted_at?: string | null
          created_at?: string
          merchant_id?: string | null
          monetised_url: string
          provider: string
          provider_subid?: string | null
          raw_url: string
          recipient_country?: string | null
          recipient_id?: string | null
          recommendation_id?: string | null
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Update: {
          buyer_country?: string | null
          click_id?: string
          commission_amount?: number | null
          commission_currency?: string | null
          commission_gbp?: number | null
          converted_at?: string | null
          created_at?: string
          merchant_id?: string | null
          monetised_url?: string
          provider?: string
          provider_subid?: string | null
          raw_url?: string
          recipient_country?: string | null
          recipient_id?: string | null
          recommendation_id?: string | null
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_clicks_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_merchant_eligibility: {
        Row: {
          affiliate_network: string
          affiliate_program_id: string | null
          commission_rate_pct: number | null
          country_code: string
          created_at: string
          is_active: boolean
          merchant_display_name: string
          merchant_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          affiliate_network: string
          affiliate_program_id?: string | null
          commission_rate_pct?: number | null
          country_code: string
          created_at?: string
          is_active?: boolean
          merchant_display_name: string
          merchant_id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_network?: string
          affiliate_program_id?: string | null
          commission_rate_pct?: number | null
          country_code?: string
          created_at?: string
          is_active?: boolean
          merchant_display_name?: string
          merchant_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      consent_log: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          subject_id: string | null
          subject_kind: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          subject_id?: string | null
          subject_kind?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          subject_id?: string | null
          subject_kind?: string | null
          user_id?: string
        }
        Relationships: []
      }
      contact_methods: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
          kind: string
          updated_at: string
          value: string
          verified_at: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          kind: string
          updated_at?: string
          value: string
          verified_at?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          kind?: string
          updated_at?: string
          value?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_methods_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          deleted_at: string | null
          display_name: string
          external_id: string | null
          id: string
          linked_profile_id: string | null
          notes: string | null
          owner_user_id: string
          source: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name: string
          external_id?: string | null
          id?: string
          linked_profile_id?: string | null
          notes?: string | null
          owner_user_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          external_id?: string | null
          id?: string
          linked_profile_id?: string | null
          notes?: string | null
          owner_user_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_linked_profile_id_fkey"
            columns: ["linked_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_linked_profile_id_fkey"
            columns: ["linked_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_moderation_flags: {
        Row: {
          content_snippet: string
          created_at: string
          field: string
          flags: string[]
          id: string
          profile_id: string | null
          severity: string
          source: string
        }
        Insert: {
          content_snippet: string
          created_at?: string
          field: string
          flags: string[]
          id?: string
          profile_id?: string | null
          severity: string
          source: string
        }
        Update: {
          content_snippet?: string
          created_at?: string
          field?: string
          flags?: string[]
          id?: string
          profile_id?: string | null
          severity?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_moderation_flags_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_moderation_flags_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_starter_prompts: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          prompt: string
          sort_order: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          prompt: string
          sort_order?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          prompt?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      erasure_obligations: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          processors: string[]
          status: string
          subject_email: string | null
          subject_user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          processors?: string[]
          status?: string
          subject_email?: string | null
          subject_user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          processors?: string[]
          status?: string
          subject_email?: string | null
          subject_user_id?: string
        }
        Relationships: []
      }
      external_links: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          link_type: Database["public"]["Enums"]["link_type"] | null
          profile_id: string
          sort_order: number | null
          title: string
          url: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          link_type?: Database["public"]["Enums"]["link_type"] | null
          profile_id: string
          sort_order?: number | null
          title: string
          url: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          link_type?: Database["public"]["Enums"]["link_type"] | null
          profile_id?: string
          sort_order?: number | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_entitlements: {
        Row: {
          enabled: boolean
          feature_key: string
          granted_at: string
          granted_by: string | null
          id: string
          metadata: Json | null
          profile_id: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          metadata?: Json | null
          profile_id: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          metadata?: Json | null
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_entitlements_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_entitlements_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_entitlements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_entitlements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_events_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          gathering_id: string
          id: string
          metadata: Json
          subject_id: string | null
          subject_kind: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          gathering_id: string
          id?: string
          metadata?: Json
          subject_id?: string | null
          subject_kind?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          gathering_id?: string
          id?: string
          metadata?: Json
          subject_id?: string | null
          subject_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gathering_events_log_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_invite_messages: {
        Row: {
          bounce_reason: string | null
          channel: string
          claimed_at: string | null
          created_at: string
          delivery_status: string
          external_message_id: string | null
          gathering_id: string
          id: string
          invitee_id: string
          sent_at: string | null
          template_name: string
        }
        Insert: {
          bounce_reason?: string | null
          channel: string
          claimed_at?: string | null
          created_at?: string
          delivery_status?: string
          external_message_id?: string | null
          gathering_id: string
          id?: string
          invitee_id: string
          sent_at?: string | null
          template_name: string
        }
        Update: {
          bounce_reason?: string | null
          channel?: string
          claimed_at?: string | null
          created_at?: string
          delivery_status?: string
          external_message_id?: string | null
          gathering_id?: string
          id?: string
          invitee_id?: string
          sent_at?: string | null
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_invite_messages_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gathering_invite_messages_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: false
            referencedRelation: "gathering_invitees"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_invitees: {
        Row: {
          contact_id: string
          created_at: string
          dietary_overrides: string | null
          gathering_id: string
          id: string
          invited_at: string | null
          notes: string | null
          plus_ones: number
          responded_at: string | null
          rsvp_token: string | null
          rsvp_token_expires_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          dietary_overrides?: string | null
          gathering_id: string
          id?: string
          invited_at?: string | null
          notes?: string | null
          plus_ones?: number
          responded_at?: string | null
          rsvp_token?: string | null
          rsvp_token_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          dietary_overrides?: string | null
          gathering_id?: string
          id?: string
          invited_at?: string | null
          notes?: string | null
          plus_ones?: number
          responded_at?: string | null
          rsvp_token?: string | null
          rsvp_token_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_invitees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gathering_invitees_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gathering_proposed_slots: {
        Row: {
          availability_breakdown: Json
          created_at: string
          gathering_id: string
          id: string
          score: number | null
          slot_end: string
          slot_start: string
        }
        Insert: {
          availability_breakdown?: Json
          created_at?: string
          gathering_id: string
          id?: string
          score?: number | null
          slot_end: string
          slot_start: string
        }
        Update: {
          availability_breakdown?: Json
          created_at?: string
          gathering_id?: string
          id?: string
          score?: number | null
          slot_end?: string
          slot_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "gathering_proposed_slots_gathering_id_fkey"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
        ]
      }
      gatherings: {
        Row: {
          accessibility_required: string[]
          capacity_max: number | null
          capacity_min: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          dietary_summary: string | null
          finalised_slot_end: string | null
          finalised_slot_start: string | null
          gathering_type: string
          host_user_id: string
          id: string
          notes: string | null
          silence_nudge_days: number
          silence_presumed_declined_days: number
          status: string
          target_window_end: string | null
          target_window_start: string | null
          title: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          accessibility_required?: string[]
          capacity_max?: number | null
          capacity_min?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          dietary_summary?: string | null
          finalised_slot_end?: string | null
          finalised_slot_start?: string | null
          gathering_type: string
          host_user_id: string
          id?: string
          notes?: string | null
          silence_nudge_days?: number
          silence_presumed_declined_days?: number
          status?: string
          target_window_end?: string | null
          target_window_start?: string | null
          title: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          accessibility_required?: string[]
          capacity_max?: number | null
          capacity_min?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          dietary_summary?: string | null
          finalised_slot_end?: string | null
          finalised_slot_start?: string | null
          gathering_type?: string
          host_user_id?: string
          id?: string
          notes?: string | null
          silence_nudge_days?: number
          silence_presumed_declined_days?: number
          status?: string
          target_window_end?: string | null
          target_window_start?: string | null
          title?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gatherings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_suggestion_dismissals: {
        Row: {
          dismissed_at: string
          profile_id: string
          suggestion_key: string
        }
        Insert: {
          dismissed_at?: string
          profile_id: string
          suggestion_key: string
        }
        Update: {
          dismissed_at?: string
          profile_id?: string
          suggestion_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_suggestion_dismissals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_suggestion_dismissals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      global_feature_switches: {
        Row: {
          created_at: string
          enabled: boolean
          environment: string
          feature_key: string
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          environment: string
          feature_key: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          environment?: string
          feature_key?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "global_feature_switches_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_feature_switches_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_tool_call_log: {
        Row: {
          api_key_prefix: string | null
          id: string
          ip: string
          method: string
          status_code: number | null
          tool: string
          ts: string
        }
        Insert: {
          api_key_prefix?: string | null
          id?: string
          ip: string
          method: string
          status_code?: number | null
          tool: string
          ts?: string
        }
        Update: {
          api_key_prefix?: string | null
          id?: string
          ip?: string
          method?: string
          status_code?: number | null
          tool?: string
          ts?: string
        }
        Relationships: []
      }
      moderation_logs: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json
          prev_hash: string | null
          reason: string | null
          row_hash: string
          seq: number
          target_item_id: string | null
          target_profile_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          metadata?: Json
          prev_hash?: string | null
          reason?: string | null
          row_hash: string
          seq: number
          target_item_id?: string | null
          target_profile_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          prev_hash?: string | null
          reason?: string | null
          row_hash?: string
          seq?: number
          target_item_id?: string | null
          target_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_logs_target_item_id_fkey"
            columns: ["target_item_id"]
            isOneToOne: false
            referencedRelation: "profile_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_logs_target_profile_id_fkey"
            columns: ["target_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_logs_target_profile_id_fkey"
            columns: ["target_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_access_tokens: {
        Row: {
          client_id: string
          expires_at: string
          issued_at: string
          jti: string
          revoked_at: string | null
          scope: string
          user_id: string
        }
        Insert: {
          client_id: string
          expires_at: string
          issued_at?: string
          jti?: string
          revoked_at?: string | null
          scope: string
          user_id: string
        }
        Update: {
          client_id?: string
          expires_at?: string
          issued_at?: string
          jti?: string
          revoked_at?: string | null
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_access_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      oauth_authorization_codes: {
        Row: {
          client_id: string
          code: string
          code_challenge: string
          code_challenge_method: string
          created_at: string
          expires_at: string
          redirect_uri: string
          resource: string | null
          scope: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          code: string
          code_challenge: string
          code_challenge_method: string
          created_at?: string
          expires_at: string
          redirect_uri: string
          resource?: string | null
          scope: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          code?: string
          code_challenge?: string
          code_challenge_method?: string
          created_at?: string
          expires_at?: string
          redirect_uri?: string
          resource?: string | null
          scope?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorization_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          application_type: string
          client_id: string
          client_name: string
          client_secret_hash: string | null
          created_at: string
          grant_types: string[]
          id: string
          is_first_party: boolean
          redirect_uris: string[]
          response_types: string[]
          revoked_at: string | null
          scopes: string
          token_endpoint_auth_method: string
          updated_at: string
        }
        Insert: {
          application_type?: string
          client_id: string
          client_name: string
          client_secret_hash?: string | null
          created_at?: string
          grant_types?: string[]
          id?: string
          is_first_party?: boolean
          redirect_uris: string[]
          response_types?: string[]
          revoked_at?: string | null
          scopes?: string
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Update: {
          application_type?: string
          client_id?: string
          client_name?: string
          client_secret_hash?: string | null
          created_at?: string
          grant_types?: string[]
          id?: string
          is_first_party?: boolean
          redirect_uris?: string[]
          response_types?: string[]
          revoked_at?: string | null
          scopes?: string
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Relationships: []
      }
      oauth_connect_state: {
        Row: {
          created_at: string
          expires_at: string
          provider: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          provider: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          provider?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      oauth_connections: {
        Row: {
          access_token_expires_at: string | null
          access_token_secret_id: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          id: string
          last_used_at: string | null
          owner_user_id: string
          provider: string
          provider_account_id: string
          refresh_token_secret_id: string
          scope_granted: string
          status: string
          updated_at: string
        }
        Insert: {
          access_token_expires_at?: string | null
          access_token_secret_id?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          last_used_at?: string | null
          owner_user_id: string
          provider: string
          provider_account_id: string
          refresh_token_secret_id: string
          scope_granted: string
          status?: string
          updated_at?: string
        }
        Update: {
          access_token_expires_at?: string | null
          access_token_secret_id?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          last_used_at?: string | null
          owner_user_id?: string
          provider?: string
          provider_account_id?: string
          refresh_token_secret_id?: string
          scope_granted?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      oauth_consents: {
        Row: {
          client_id: string
          granted_at: string
          id: string
          revoked_at: string | null
          scopes: string
          user_id: string
        }
        Insert: {
          client_id: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          scopes: string
          user_id: string
        }
        Update: {
          client_id?: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          scopes?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      oauth_refresh_tokens: {
        Row: {
          client_id: string
          expires_at: string
          family_id: string
          issued_at: string
          resource: string | null
          scope: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          expires_at: string
          family_id: string
          issued_at?: string
          resource?: string | null
          scope: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          expires_at?: string
          family_id?: string
          issued_at?: string
          resource?: string | null
          scope?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_refresh_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      oauth_scopes_granted: {
        Row: {
          granted_at: string
          id: string
          oauth_connection_id: string
          revoked_at: string | null
          scope: string
        }
        Insert: {
          granted_at?: string
          id?: string
          oauth_connection_id: string
          revoked_at?: string | null
          scope: string
        }
        Update: {
          granted_at?: string
          id?: string
          oauth_connection_id?: string
          revoked_at?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_scopes_granted_oauth_connection_id_fkey"
            columns: ["oauth_connection_id"]
            isOneToOne: false
            referencedRelation: "oauth_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_conversation_starters: {
        Row: {
          answer: string
          created_at: string | null
          custom_prompt: string | null
          id: string
          profile_id: string
          prompt_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          answer: string
          created_at?: string | null
          custom_prompt?: string | null
          id?: string
          profile_id: string
          prompt_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          answer?: string
          created_at?: string | null
          custom_prompt?: string | null
          id?: string
          profile_id?: string
          prompt_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_conversation_starters_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_conversation_starters_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_conversation_starters_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "conversation_starter_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_files: {
        Row: {
          created_at: string | null
          file_name: string
          id: string
          mime_type: string
          profile_id: string
          size_bytes: number
          sort_order: number | null
          storage_path: string
          visibility: Database["public"]["Enums"]["visibility_level"] | null
        }
        Insert: {
          created_at?: string | null
          file_name: string
          id?: string
          mime_type: string
          profile_id: string
          size_bytes: number
          sort_order?: number | null
          storage_path: string
          visibility?: Database["public"]["Enums"]["visibility_level"] | null
        }
        Update: {
          created_at?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          profile_id?: string
          size_bytes?: number
          sort_order?: number | null
          storage_path?: string
          visibility?: Database["public"]["Enums"]["visibility_level"] | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_files_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_files_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_items: {
        Row: {
          category: Database["public"]["Enums"]["item_category"]
          created_at: string | null
          description: string | null
          group_label: string | null
          id: string
          profile_id: string
          sort_order: number | null
          title: string
          url: string | null
          visibility: Database["public"]["Enums"]["visibility_level"] | null
        }
        Insert: {
          category: Database["public"]["Enums"]["item_category"]
          created_at?: string | null
          description?: string | null
          group_label?: string | null
          id?: string
          profile_id: string
          sort_order?: number | null
          title: string
          url?: string | null
          visibility?: Database["public"]["Enums"]["visibility_level"] | null
        }
        Update: {
          category?: Database["public"]["Enums"]["item_category"]
          created_at?: string | null
          description?: string | null
          group_label?: string | null
          id?: string
          profile_id?: string
          sort_order?: number | null
          title?: string
          url?: string | null
          visibility?: Database["public"]["Enums"]["visibility_level"] | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_manual_of_me: {
        Row: {
          boundaries: string | null
          communication_style: string | null
          created_at: string | null
          drains_me: string | null
          energises_me: string | null
          good_to_know: string | null
          profile_id: string
          updated_at: string | null
          working_preferences: string | null
        }
        Insert: {
          boundaries?: string | null
          communication_style?: string | null
          created_at?: string | null
          drains_me?: string | null
          energises_me?: string | null
          good_to_know?: string | null
          profile_id: string
          updated_at?: string | null
          working_preferences?: string | null
        }
        Update: {
          boundaries?: string | null
          communication_style?: string | null
          created_at?: string | null
          drains_me?: string | null
          energises_me?: string | null
          good_to_know?: string | null
          profile_id?: string
          updated_at?: string | null
          working_preferences?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_manual_of_me_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_manual_of_me_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_tier: Database["public"]["Enums"]["access_tier"]
          age_checked_at: string | null
          age_declared_18_at: string | null
          age_provider: string | null
          age_provider_ref: string | null
          age_range: string | null
          age_status: Database["public"]["Enums"]["age_status"]
          avatar_url: string | null
          beta_approved_at: string | null
          beta_requested_at: string | null
          bio_short: string | null
          city: string | null
          completion_score: number | null
          country: string | null
          created_at: string | null
          dashboard_widget_state: Json
          delivery_country_code: string | null
          display_name: string
          gift_voucher_hint: string | null
          headline: string | null
          homepage_example_order: number | null
          id: string
          is_admin: boolean
          is_homepage_example: boolean
          is_published: boolean | null
          is_suspended: boolean
          onboarding_complete: boolean | null
          postcode_prefix: string | null
          recipient_attributes: Json
          region: string | null
          section_visibility: Json
          share_availability_with_contacts: boolean
          slug: string
          suspended_at: string | null
          suspension_reason: string | null
          updated_at: string | null
          user_id: string
          user_status: Database["public"]["Enums"]["user_status"]
        }
        Insert: {
          access_tier?: Database["public"]["Enums"]["access_tier"]
          age_checked_at?: string | null
          age_declared_18_at?: string | null
          age_provider?: string | null
          age_provider_ref?: string | null
          age_range?: string | null
          age_status?: Database["public"]["Enums"]["age_status"]
          avatar_url?: string | null
          beta_approved_at?: string | null
          beta_requested_at?: string | null
          bio_short?: string | null
          city?: string | null
          completion_score?: number | null
          country?: string | null
          created_at?: string | null
          dashboard_widget_state?: Json
          delivery_country_code?: string | null
          display_name: string
          gift_voucher_hint?: string | null
          headline?: string | null
          homepage_example_order?: number | null
          id?: string
          is_admin?: boolean
          is_homepage_example?: boolean
          is_published?: boolean | null
          is_suspended?: boolean
          onboarding_complete?: boolean | null
          postcode_prefix?: string | null
          recipient_attributes?: Json
          region?: string | null
          section_visibility?: Json
          share_availability_with_contacts?: boolean
          slug: string
          suspended_at?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
          user_id: string
          user_status?: Database["public"]["Enums"]["user_status"]
        }
        Update: {
          access_tier?: Database["public"]["Enums"]["access_tier"]
          age_checked_at?: string | null
          age_declared_18_at?: string | null
          age_provider?: string | null
          age_provider_ref?: string | null
          age_range?: string | null
          age_status?: Database["public"]["Enums"]["age_status"]
          avatar_url?: string | null
          beta_approved_at?: string | null
          beta_requested_at?: string | null
          bio_short?: string | null
          city?: string | null
          completion_score?: number | null
          country?: string | null
          created_at?: string | null
          dashboard_widget_state?: Json
          delivery_country_code?: string | null
          display_name?: string
          gift_voucher_hint?: string | null
          headline?: string | null
          homepage_example_order?: number | null
          id?: string
          is_admin?: boolean
          is_homepage_example?: boolean
          is_published?: boolean | null
          is_suspended?: boolean
          onboarding_complete?: boolean | null
          postcode_prefix?: string | null
          recipient_attributes?: Json
          region?: string | null
          section_visibility?: Json
          share_availability_with_contacts?: boolean
          slug?: string
          suspended_at?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
          user_id?: string
          user_status?: Database["public"]["Enums"]["user_status"]
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          hits: number
          reset_at: string
        }
        Insert: {
          bucket: string
          hits?: number
          reset_at: string
        }
        Update: {
          bucket?: string
          hits?: number
          reset_at?: string
        }
        Relationships: []
      }
      recommendation_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          merchant_id: string | null
          metadata: Json
          recipient_id: string | null
          recommendation_id: string
          session_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string
          event_type: string
          merchant_id?: string | null
          metadata?: Json
          recipient_id?: string | null
          recommendation_id: string
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          merchant_id?: string | null
          metadata?: Json
          recipient_id?: string | null
          recommendation_id?: string
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_events_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_events_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recommender_catalogue: {
        Row: {
          buyer_countries: string[] | null
          catalogue_id: string
          concept_category: string
          concept_keywords: string[]
          created_at: string
          description: string | null
          image_url: string | null
          is_active: boolean
          merchant_id: string
          price_currency: string | null
          price_max_minor: number | null
          price_min_minor: number | null
          rationale_fragment: string | null
          raw_url: string
          title: string
          updated_at: string
          weight: number
        }
        Insert: {
          buyer_countries?: string[] | null
          catalogue_id?: string
          concept_category: string
          concept_keywords?: string[]
          created_at?: string
          description?: string | null
          image_url?: string | null
          is_active?: boolean
          merchant_id: string
          price_currency?: string | null
          price_max_minor?: number | null
          price_min_minor?: number | null
          rationale_fragment?: string | null
          raw_url: string
          title: string
          updated_at?: string
          weight?: number
        }
        Update: {
          buyer_countries?: string[] | null
          catalogue_id?: string
          concept_category?: string
          concept_keywords?: string[]
          created_at?: string
          description?: string | null
          image_url?: string | null
          is_active?: boolean
          merchant_id?: string
          price_currency?: string | null
          price_max_minor?: number | null
          price_min_minor?: number | null
          rationale_fragment?: string | null
          raw_url?: string
          title?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: string
          note: string | null
          profile_id: string
          profile_item_id: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_user_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          profile_id: string
          profile_item_id?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          profile_id?: string
          profile_item_id?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reports_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_profile_item_id_fkey"
            columns: ["profile_item_id"]
            isOneToOne: false
            referencedRelation: "profile_items"
            referencedColumns: ["id"]
          },
        ]
      }
      school_affiliations: {
        Row: {
          affiliation_type: string
          created_at: string | null
          description: string | null
          id: string
          profile_id: string
          relationship:
            | Database["public"]["Enums"]["school_relationship"]
            | null
          school_location: string | null
          school_name: string
          show_on_profile: boolean
        }
        Insert: {
          affiliation_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          profile_id: string
          relationship?:
            | Database["public"]["Enums"]["school_relationship"]
            | null
          school_location?: string | null
          school_name: string
          show_on_profile?: boolean
        }
        Update: {
          affiliation_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          profile_id?: string
          relationship?:
            | Database["public"]["Enums"]["school_relationship"]
            | null
          school_location?: string | null
          school_name?: string
          show_on_profile?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "school_affiliations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_affiliations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_members: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          tribe_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          tribe_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          tribe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tribe_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tribe_members_tribe_id_fkey"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      tribes: {
        Row: {
          color_hex: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          color_hex?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          color_hex?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      venue_ratings: {
        Row: {
          created_at: string
          id: string
          note: string | null
          rating: number
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          rating: number
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          rating?: number
          updated_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_ratings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_visits: {
        Row: {
          created_at: string
          gathering_id: string
          id: string
          venue_id: string
          visited_at: string
        }
        Insert: {
          created_at?: string
          gathering_id: string
          id?: string
          venue_id: string
          visited_at: string
        }
        Update: {
          created_at?: string
          gathering_id?: string
          id?: string
          venue_id?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_visits_gathering_fk"
            columns: ["gathering_id"]
            isOneToOne: false
            referencedRelation: "gatherings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_visits_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          accessibility_flags: string[]
          address_line1: string | null
          address_line2: string | null
          capacity_estimate: number | null
          city: string | null
          country: string
          created_at: string
          cuisine: string | null
          dietary_flags: string[]
          external_rating: number | null
          google_place_id: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          opening_hours: Json | null
          phone: string | null
          postcode: string | null
          price_tier: number | null
          region: string | null
          updated_at: string
          venue_type: string
          website_url: string | null
        }
        Insert: {
          accessibility_flags?: string[]
          address_line1?: string | null
          address_line2?: string | null
          capacity_estimate?: number | null
          city?: string | null
          country?: string
          created_at?: string
          cuisine?: string | null
          dietary_flags?: string[]
          external_rating?: number | null
          google_place_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          opening_hours?: Json | null
          phone?: string | null
          postcode?: string | null
          price_tier?: number | null
          region?: string | null
          updated_at?: string
          venue_type: string
          website_url?: string | null
        }
        Update: {
          accessibility_flags?: string[]
          address_line1?: string | null
          address_line2?: string | null
          capacity_estimate?: number | null
          city?: string | null
          country?: string
          created_at?: string
          cuisine?: string | null
          dietary_flags?: string[]
          external_rating?: number | null
          google_place_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          opening_hours?: Json | null
          phone?: string | null
          postcode?: string | null
          price_tier?: number | null
          region?: string | null
          updated_at?: string
          venue_type?: string
          website_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      mcp_per_ip_recent_count: {
        Row: {
          first_seen: string | null
          ip: string | null
          last_seen: string | null
          request_count: number | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_url: string | null
          bio_short: string | null
          city: string | null
          country: string | null
          delivery_country_code: string | null
          display_name: string | null
          gift_voucher_hint: string | null
          headline: string | null
          homepage_example_order: number | null
          id: string | null
          is_homepage_example: boolean | null
          is_published: boolean | null
          is_suspended: boolean | null
          section_visibility: Json | null
          slug: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio_short?: string | null
          city?: string | null
          country?: string | null
          delivery_country_code?: string | null
          display_name?: string | null
          gift_voucher_hint?: string | null
          headline?: string | null
          homepage_example_order?: number | null
          id?: string | null
          is_homepage_example?: boolean | null
          is_published?: boolean | null
          is_suspended?: boolean | null
          section_visibility?: Json | null
          slug?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio_short?: string | null
          city?: string | null
          country?: string | null
          delivery_country_code?: string | null
          display_name?: string | null
          gift_voucher_hint?: string | null
          headline?: string | null
          homepage_example_order?: number | null
          id?: string | null
          is_homepage_example?: boolean | null
          is_published?: boolean | null
          is_suspended?: boolean | null
          section_visibility?: Json | null
          slug?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      relationship_signals: {
        Row: {
          contact_id: string | null
          gathering_type_diversity: number | null
          gathering_types_seen: string[] | null
          last_attended_at: string | null
          last_invited_at: string | null
          total_accepted: number | null
          total_attended: number | null
          total_declined: number | null
          total_invites: number | null
          total_no_shows: number | null
          total_silent: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gathering_invitees_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_filter_profile_ids: {
        Args: {
          p_admin?: boolean
          p_cap?: number
          p_early?: boolean
          p_search?: string
          p_stage?: string
          p_suspended?: boolean
        }
        Returns: string[]
      }
      admin_list_users: {
        Args: {
          p_admin?: boolean
          p_early?: boolean
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_stage?: string
          p_suspended?: boolean
        }
        Returns: Json
      }
      affiliate_clicks_purge_expired: {
        Args: { cutoff: string }
        Returns: number
      }
      convene_vault_read_secret: {
        Args: { p_secret_id: string }
        Returns: string
      }
      convene_vault_revoke_secret: {
        Args: { p_secret_id: string }
        Returns: undefined
      }
      convene_vault_store_secret: {
        Args: { p_description: string; p_secret: string }
        Returns: string
      }
      gatherings_purge_expired: { Args: { cutoff: string }; Returns: number }
      get_metrics_for_window: {
        Args: { p_end_at: string; p_start_at: string }
        Returns: Json
      }
      moderation_log_row_hash: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_created_at: string
          p_id: string
          p_metadata: Json
          p_prev_hash: string
          p_reason: string
          p_seq: number
          p_target_item_id: string
          p_target_profile_id: string
        }
        Returns: string
      }
      oauth_connect_state_purge_expired: { Args: never; Returns: number }
      rate_limit_hit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: {
          limited: boolean
          retry_after: number
        }[]
      }
      record_erasure_obligation: {
        Args: {
          p_notes?: string
          p_processors: string[]
          p_subject_email: string
          p_subject_user_id: string
        }
        Returns: string
      }
      refresh_relationship_signals: { Args: never; Returns: undefined }
      security_invariants_report: {
        Args: never
        Returns: {
          detail: string
          invariant: string
          object_name: string
        }[]
      }
      tribe_only_visible_tribes: {
        Args: { p_profile_user_id: string }
        Returns: {
          tribe_id: string
        }[]
      }
      verify_moderation_log_chain: {
        Args: never
        Returns: {
          detail: string
          first_bad_seq: number
          ok: boolean
          rows_checked: number
        }[]
      }
    }
    Enums: {
      access_stage: "waitlist" | "beta" | "live"
      access_tier: "beta" | "prod"
      age_status: "none" | "pending" | "passed" | "failed" | "manual_review"
      beta_access_status: "none" | "requested" | "approved"
      item_category:
        | "gift_ideas"
        | "gifts_to_avoid"
        | "likes"
        | "dislikes"
        | "helpful_to_know"
        | "boundaries"
        | "favourite_books"
        | "favourite_media"
        | "causes"
        | "quotes"
        | "proud_of"
        | "life_hacks"
        | "questions"
        | "billboard"
        | "current_problems"
        | "dietary"
        | "mobility"
        | "transport"
        | "availability_pattern"
        | "favourite_venues"
        | "allergies"
        | "favourite_tv"
        | "favourite_places"
        | "favourite_music"
        | "plays"
        | "favourite_custom"
      link_type: "retailer" | "wishlist" | "article" | "general"
      report_reason:
        | "spam"
        | "harassment"
        | "impersonation"
        | "inappropriate"
        | "other"
      report_status: "pending" | "reviewed" | "actioned" | "dismissed"
      school_relationship: "parent" | "student" | "alumni" | "staff" | "other"
      user_status: "not_applied" | "waitlist" | "live"
      visibility_level:
        | "public"
        | "members_only"
        | "private"
        | "tribe_only"
        | "draft"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_stage: ["waitlist", "beta", "live"],
      access_tier: ["beta", "prod"],
      age_status: ["none", "pending", "passed", "failed", "manual_review"],
      beta_access_status: ["none", "requested", "approved"],
      item_category: [
        "gift_ideas",
        "gifts_to_avoid",
        "likes",
        "dislikes",
        "helpful_to_know",
        "boundaries",
        "favourite_books",
        "favourite_media",
        "causes",
        "quotes",
        "proud_of",
        "life_hacks",
        "questions",
        "billboard",
        "current_problems",
        "dietary",
        "mobility",
        "transport",
        "availability_pattern",
        "favourite_venues",
        "allergies",
        "favourite_tv",
        "favourite_places",
        "favourite_music",
        "plays",
        "favourite_custom",
      ],
      link_type: ["retailer", "wishlist", "article", "general"],
      report_reason: [
        "spam",
        "harassment",
        "impersonation",
        "inappropriate",
        "other",
      ],
      report_status: ["pending", "reviewed", "actioned", "dismissed"],
      school_relationship: ["parent", "student", "alumni", "staff", "other"],
      user_status: ["not_applied", "waitlist", "live"],
      visibility_level: [
        "public",
        "members_only",
        "private",
        "tribe_only",
        "draft",
      ],
    },
  },
} as const

