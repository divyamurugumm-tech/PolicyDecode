const express = require('express');
const router = express.Router();

const { fetchAndCleanPolicy, isValidUrl } = require('../services/fetchPolicy');
const { analyzePolicyWithLlm } = require('../services/llm');
const { verifyFlags } = require('../services/verifyQuote');
const { calculateRisk, sortAndFilterFlags } = require('../services/risk');
const { supabase } = require('../db');

/**
 * POST /analyze
 * Body: { "url": "https://..." }
 */
router.post('/analyze', async (req, res, next) => {
  try {
    const { url } = req.body || {};

    // 1. Validate URL presence and format
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return res.status(400).json({ error: "Request body must include a valid 'url' field." });
    }

    const trimmedUrl = url.trim();
    if (!isValidUrl(trimmedUrl)) {
      return res.status(400).json({ error: 'Invalid URL. Must be an http or https URL.' });
    }

    // 2. Fetch page and clean readable text
    const { domain, fullText, contentHash } = await fetchAndCleanPolicy(trimmedUrl);

    // 3. Check for existing cached analysis by content_hash in DB
    try {
      const { data: cachedPolicy, error: policyQueryError } = await supabase
        .from('policies')
        .select('id')
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (policyQueryError) {
        throw new Error(`Failed to query policies table: ${policyQueryError.message}`);
      }

      if (cachedPolicy) {
        // Fetch the corresponding analysis
        const { data: cachedAnalysis, error: analysisQueryError } = await supabase
          .from('analyses')
          .select('id, risk_level')
          .eq('policy_id', cachedPolicy.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (analysisQueryError) {
          throw new Error(`Failed to query analyses table: ${analysisQueryError.message}`);
        }

        if (cachedAnalysis) {
          // Fetch existing flags
          const { data: cachedFlags, error: flagsQueryError } = await supabase
            .from('flags')
            .select('category, severity, title, explanation, quote, verified')
            .eq('analysis_id', cachedAnalysis.id);

          if (flagsQueryError) {
            throw new Error(`Failed to query flags table: ${flagsQueryError.message}`);
          }

          const formattedFlags = sortAndFilterFlags(cachedFlags || [], 3).map((f) => ({
            category: f.category,
            severity: f.severity,
            title: f.title,
            explanation: f.explanation,
            quote: f.quote,
            verified: Boolean(f.verified),
          }));

          return res.status(200).json({
            risk: cachedAnalysis.risk_level,
            flags: formattedFlags,
          });
        }
      }
    } catch (dbError) {
      // Re-throw database query error with 500 status
      const error = new Error(`Database error during cache lookup: ${dbError.message}`);
      error.status = 500;
      throw error;
    }

    // 4. Call LLM with strict prompt to extract flags
    const extractedFlags = await analyzePolicyWithLlm(fullText);

    // 5. Verify quotes against policy text (mark verified: true | false)
    const verifiedFlags = verifyFlags(extractedFlags, fullText);

    // 6. Compute overall risk in code (not LLM)
    const risk = calculateRisk(verifiedFlags);

    // Filter and sort flags: top 3 sorted by severity (high first)
    const topFlags = sortAndFilterFlags(verifiedFlags, 3).map((f) => ({
      category: f.category,
      severity: f.severity,
      title: f.title,
      explanation: f.explanation,
      quote: f.quote,
      verified: Boolean(f.verified),
    }));

    // 7. Save policy, analysis, and flags to DB
    try {
      // Insert policy
      const { data: insertedPolicy, error: insertPolicyError } = await supabase
        .from('policies')
        .insert({
          domain,
          url: trimmedUrl,
          content_hash: contentHash,
          full_text: fullText,
          fetched_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertPolicyError) {
        throw new Error(`Failed to save policy: ${insertPolicyError.message}`);
      }

      // Insert analysis
      const { data: insertedAnalysis, error: insertAnalysisError } = await supabase
        .from('analyses')
        .insert({
          policy_id: insertedPolicy.id,
          risk_level: risk,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertAnalysisError) {
        throw new Error(`Failed to save analysis: ${insertAnalysisError.message}`);
      }

      // Insert flags (save all verified flags or top flags)
      if (verifiedFlags.length > 0) {
        const flagsData = verifiedFlags.map((flag) => ({
          analysis_id: insertedAnalysis.id,
          category: flag.category,
          severity: flag.severity,
          title: flag.title,
          explanation: flag.explanation,
          quote: flag.quote,
          verified: Boolean(flag.verified),
        }));

        const { error: insertFlagsError } = await supabase.from('flags').insert(flagsData);

        if (insertFlagsError) {
          throw new Error(`Failed to save flags: ${insertFlagsError.message}`);
        }
      }
    } catch (dbSaveError) {
      const error = new Error(`Database error while saving analysis: ${dbSaveError.message}`);
      error.status = 500;
      throw error;
    }

    // 8. Return response
    return res.status(200).json({
      risk,
      flags: topFlags,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
