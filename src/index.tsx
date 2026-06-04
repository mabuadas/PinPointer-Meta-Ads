import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  META_ACCESS_TOKEN: string
  META_API_VERSION: string
  META_APP_ID: string
  META_BUSINESS_ID: string
  GOOGLE_API_KEY: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for all API routes
app.use('/api/*', cors())

// Serve static files from public directory
app.use('/static/*', serveStatic({ root: './public' }))

// Meta Graph API Base URL
const getGraphApiUrl = (path: string, version: string) => 
  `https://graph.facebook.com/${version}${path}`

// Helper function to make Meta API requests with better error handling
async function metaApiRequest(url: string, accessToken: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      console.error('Meta API Error:', data)
      throw new Error(data.error?.message || JSON.stringify(data))
    }
    
    return data
  } catch (error: any) {
    console.error('Request Error:', error)
    throw error
  }
}

// API Routes

// Get user's ad accounts
app.get('/api/me/adaccounts', async (c) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION } = c.env
    
    // Fetch all ad accounts with pagination
    let allAccounts = []
    let url = getGraphApiUrl(
      `/me/adaccounts?fields=id,name,account_id,account_status,currency,timezone_name,business&limit=100&access_token=${META_ACCESS_TOKEN}`,
      META_API_VERSION
    )
    
    // Loop through all pages
    while (url) {
      const data = await metaApiRequest(url, META_ACCESS_TOKEN)
      
      if (data.data && data.data.length > 0) {
        allAccounts = allAccounts.concat(data.data)
      }
      
      // Check if there's a next page
      if (data.paging && data.paging.next) {
        url = data.paging.next
      } else {
        url = null
      }
    }
    
    return c.json({
      data: allAccounts,
      count: allAccounts.length
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get campaigns for an ad account
app.get('/api/account/:accountId/campaigns', async (c) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION } = c.env
    const accountId = c.req.param('accountId')
    const url = getGraphApiUrl(
      `/act_${accountId}/campaigns?fields=id,name,objective,status,daily_budget,lifetime_budget,created_time,updated_time,start_time,stop_time,buying_type&access_token=${META_ACCESS_TOKEN}`,
      META_API_VERSION
    )
    const data = await metaApiRequest(url, META_ACCESS_TOKEN)
    return c.json(data)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get ad sets for a campaign (for budget calculation)
app.get('/api/campaign/:campaignId/adsets/budget', async (c) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION } = c.env
    const campaignId = c.req.param('campaignId')
    const url = getGraphApiUrl(
      `/${campaignId}/adsets?fields=daily_budget,lifetime_budget&access_token=${META_ACCESS_TOKEN}`,
      META_API_VERSION
    )
    const data = await metaApiRequest(url, META_ACCESS_TOKEN)
    return c.json(data)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get campaign insights with core metrics only
app.get('/api/campaign/:campaignId/insights', async (c) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION } = c.env
    const campaignId = c.req.param('campaignId')
    const datePreset = c.req.query('date_preset') || 'last_30d'
    
    // Use only core, reliable metrics that are always available
    const fields = [
      'impressions',
      'clicks',
      'spend',
      'reach',
      'frequency',
      'ctr',
      'cpm',
      'cpp',
      'cpc',
      'actions',
      'cost_per_action_type',
      'inline_link_clicks',
      'inline_link_click_ctr',
      'cost_per_inline_link_click'
    ].join(',')
    
    const url = getGraphApiUrl(
      `/${campaignId}/insights?fields=${fields}&date_preset=${datePreset}&access_token=${META_ACCESS_TOKEN}`,
      META_API_VERSION
    )
    
    const data = await metaApiRequest(url, META_ACCESS_TOKEN)
    
    // Process actions to extract conversions and other key metrics
    if (data.data && data.data.length > 0) {
      let insights = data.data[0]
      
      // Extract metrics from actions array
      if (insights.actions) {
        let totalConversions = 0
        let purchases = 0
        let leads = 0
        let addToCart = 0
        let pageViews = 0
        let postEngagements = 0
        let videoViews = 0
        let linkClicks = 0
        
        insights.actions.forEach((action: any) => {
          const actionType = action.action_type
          const value = parseInt(action.value || 0)
          
          // Purchase conversions
          if (actionType.includes('purchase') || actionType.includes('complete_registration')) {
            purchases += value
            totalConversions += value
          }
          // Lead conversions
          else if (actionType.includes('lead')) {
            leads += value
            totalConversions += value
          }
          // Add to cart
          else if (actionType.includes('add_to_cart') || actionType.includes('initiate_checkout')) {
            addToCart += value
          }
          // Page views and link clicks
          else if (actionType === 'landing_page_view') {
            pageViews += value
          }
          else if (actionType === 'link_click') {
            linkClicks += value
          }
          // Engagement actions (likes, comments, shares, reactions)
          else if (actionType === 'post' || 
                   actionType === 'post_engagement' ||
                   actionType === 'like' || 
                   actionType === 'post_reaction' ||
                   actionType === 'comment' || 
                   actionType === 'share' ||
                   actionType === 'page_engagement' ||
                   actionType === 'onsite_conversion.post_save') {
            postEngagements += value
          }
          // Video views
          else if (actionType.includes('video_view')) {
            videoViews += value
          }
        })
        
        insights.conversions = totalConversions
        insights.purchases = purchases
        insights.leads = leads
        insights.add_to_cart = addToCart
        insights.page_views = pageViews
        insights.post_engagements = postEngagements
        insights.video_views = videoViews
        insights.link_clicks_action = linkClicks
        
        // Calculate conversion rate
        if (insights.clicks && parseInt(insights.clicks) > 0) {
          insights.conversion_rate = ((totalConversions / parseInt(insights.clicks)) * 100).toFixed(2)
        } else {
          insights.conversion_rate = '0.00'
        }
        
        // Calculate cost per conversion
        if (totalConversions > 0) {
          insights.cost_per_conversion = (parseFloat(insights.spend) / totalConversions).toFixed(2)
        } else {
          insights.cost_per_conversion = '0.00'
        }
        
        // Calculate engagement rate
        if (insights.impressions && parseInt(insights.impressions) > 0) {
          insights.engagement_rate = ((postEngagements / parseInt(insights.impressions)) * 100).toFixed(2)
        } else {
          insights.engagement_rate = '0.00'
        }
        
        // Cost per engagement
        if (postEngagements > 0) {
          insights.cost_per_engagement = (parseFloat(insights.spend) / postEngagements).toFixed(2)
        } else {
          insights.cost_per_engagement = '0.00'
        }
        
        // Video metrics
        if (videoViews > 0) {
          insights.cost_per_video_view = (parseFloat(insights.spend) / videoViews).toFixed(2)
        } else {
          insights.cost_per_video_view = '0.00'
        }
        
        // Cost per lead
        if (leads > 0) {
          insights.cost_per_lead = (parseFloat(insights.spend) / leads).toFixed(2)
        } else {
          insights.cost_per_lead = '0.00'
        }
        
      } else {
        // Default values if no actions
        insights.conversions = 0
        insights.conversion_rate = '0.00'
        insights.cost_per_conversion = '0.00'
        insights.post_engagements = 0
        insights.engagement_rate = '0.00'
        insights.cost_per_engagement = '0.00'
        insights.leads = 0
        insights.cost_per_lead = '0.00'
        insights.video_views = 0
        insights.cost_per_video_view = '0.00'
        insights.link_clicks_action = 0
      }
    }
    
    return c.json(data)
  } catch (error: any) {
    console.error('Campaign insights error:', error)
    return c.json({ 
      error: error.message,
      data: [] 
    }, 200) // Return 200 with empty data to prevent frontend errors
  }
})

// Get ad sets for a campaign
app.get('/api/campaign/:campaignId/adsets', async (c) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION } = c.env
    const campaignId = c.req.param('campaignId')
    const url = getGraphApiUrl(
      `/${campaignId}/adsets?fields=id,name,status,daily_budget,lifetime_budget,bid_strategy,optimization_goal,billing_event,targeting,start_time,end_time,created_time,updated_time&access_token=${META_ACCESS_TOKEN}`,
      META_API_VERSION
    )
    const data = await metaApiRequest(url, META_ACCESS_TOKEN)
    return c.json(data)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get ads for an ad set
app.get('/api/adset/:adsetId/ads', async (c) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION } = c.env
    const adsetId = c.req.param('adsetId')
    const url = getGraphApiUrl(
      `/${adsetId}/ads?fields=id,name,status,creative,effective_status,created_time,updated_time&access_token=${META_ACCESS_TOKEN}`,
      META_API_VERSION
    )
    const data = await metaApiRequest(url, META_ACCESS_TOKEN)
    return c.json(data)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get ad creative details
app.get('/api/ad/:adId/creative', async (c) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION } = c.env
    const adId = c.req.param('adId')
    const url = getGraphApiUrl(
      `/${adId}?fields=creative{id,name,title,body,image_url,video_id,thumbnail_url,link_url,call_to_action_type,object_story_spec,asset_feed_spec}&access_token=${META_ACCESS_TOKEN}`,
      META_API_VERSION
    )
    const data = await metaApiRequest(url, META_ACCESS_TOKEN)
    return c.json(data)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Generate optimization suggestions - COMPREHENSIVE MARKETING ENGINE
app.post('/api/optimize/suggestions', async (c) => {
  try {
    const body = await c.req.json()
    const { insights, objective, campaignData } = body
    
    const suggestions = generateOptimizationSuggestions(insights, objective, campaignData)
    return c.json({ suggestions })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// COMPREHENSIVE OPTIMIZATION ENGINE with Meta Marketing Expertise
function generateOptimizationSuggestions(insights: any, objective: string, campaignData: any) {
  const suggestions: any[] = []
  
  if (!insights || !insights.data || insights.data.length === 0) {
    return [{
      type: 'info',
      title: 'Insufficient Data',
      description: 'This campaign needs more data before we can provide optimization suggestions. Let it run for at least 24-48 hours to gather meaningful insights.',
      priority: 'low',
      recommendations: [
        'Ensure your campaign has been active for at least 24 hours',
        'Verify Facebook Pixel is properly installed if tracking conversions',
        'Check that your budget is sufficient to generate meaningful data',
        'Confirm your targeting audience is large enough (at least 50,000 people)'
      ]
    }]
  }
  
  const data = insights.data[0]
  const impressions = parseInt(data.impressions || 0)
  const clicks = parseInt(data.clicks || 0)
  const spend = parseFloat(data.spend || 0)
  const reach = parseInt(data.reach || 0)
  const frequency = parseFloat(data.frequency || 0)
  const ctr = parseFloat(data.ctr || 0)
  const cpc = parseFloat(data.cpc || 0)
  const cpm = parseFloat(data.cpm || 0)
  const conversions = parseInt(data.conversions || 0)
  const conversionRate = parseFloat(data.conversion_rate || 0)
  const costPerConversion = parseFloat(data.cost_per_conversion || 0)
  const inlineLinkClicks = parseInt(data.inline_link_clicks || 0)
  const inlineLinkClickCtr = parseFloat(data.inline_link_click_ctr || 0)
  
  // ====================
  // CTR OPTIMIZATION
  // ====================
  if (impressions > 1000) { // Need sufficient data
    if (ctr < 0.5) {
      suggestions.push({
        type: 'error',
        title: '🚨 Critical: Very Low Click-Through Rate',
        description: `Your CTR is ${ctr.toFixed(2)}%, which is critically low (industry average: 1-2%). This indicates your ads are not resonating with your audience.`,
        priority: 'critical',
        kpi: 'CTR',
        currentValue: `${ctr.toFixed(2)}%`,
        targetValue: '1.5-2.5%',
        recommendations: [
          '🎨 Creative Strategy: Your ad creative needs immediate attention. Test bold, eye-catching visuals that stand out in the feed',
          '📝 Ad Copy: Rewrite your headline to include a clear benefit or hook (e.g., "Save 50%" or "Limited Time Offer")',
          '🎯 Targeting Refinement: Your audience may be too broad or misaligned. Narrow targeting to highly relevant interests',
          '📸 Test Different Formats: Try video ads if using images, or carousel if using single images',
          '💡 Add Urgency: Include time-sensitive elements like "Today Only" or "Last Chance"',
          '🔍 Competitive Analysis: Research what competitors in your niche are doing differently'
        ],
        impact: 'HIGH - Improving CTR will lower CPC and increase overall ROI'
      })
    } else if (ctr >= 0.5 && ctr < 1.0) {
      suggestions.push({
        type: 'warning',
        title: '⚠️ Below Average Click-Through Rate',
        description: `Your CTR is ${ctr.toFixed(2)}%, below the 1-2% industry benchmark. There's significant room for improvement.`,
        priority: 'high',
        kpi: 'CTR',
        currentValue: `${ctr.toFixed(2)}%`,
        targetValue: '1.5-2.5%',
        recommendations: [
          '✨ A/B Test Creative: Create 3-5 variations of your ad creative and let them run for 3-4 days',
          '🎬 Consider Video: Video ads typically achieve 2-3x higher CTR than static images',
          '💬 Use Social Proof: Add testimonials, ratings, or "Join 10,000+ customers" messaging',
          '🔥 Strengthen Value Prop: Make your unique benefit crystal clear in the first 3 words',
          '📱 Mobile Optimization: Ensure creative is optimized for mobile viewing (most traffic)',
          '🎨 Update Creative Regularly: Refresh creative every 7-14 days to combat ad fatigue'
        ],
        impact: 'MEDIUM-HIGH - Better CTR leads to lower costs and better quality score'
      })
    } else if (ctr >= 2.0) {
      suggestions.push({
        type: 'success',
        title: '✅ Excellent Click-Through Rate',
        description: `Outstanding! Your CTR is ${ctr.toFixed(2)}%, significantly above the industry average. Your ads are highly engaging.`,
        priority: 'low',
        kpi: 'CTR',
        currentValue: `${ctr.toFixed(2)}%`,
        targetValue: 'Maintain 2%+',
        recommendations: [
          '📈 Scale This Campaign: Increase budget by 20-30% to maximize reach while maintaining performance',
          '🔄 Duplicate Winning Formula: Use this creative style/messaging as a template for new campaigns',
          '🎯 Expand to Lookalike: Create lookalike audiences based on people who clicked',
          '📊 Analyze What Works: Document what makes this creative successful for future reference',
          '💰 Consider Higher Budgets: High CTR = lower CPC, so you can afford to bid more aggressively',
          '🧪 Keep Testing: Even winners can be improved - test small variations'
        ],
        impact: 'Maintain current performance while scaling'
      })
    }
  }
  
  // ====================
  // CPC OPTIMIZATION
  // ====================
  if (clicks > 50) {
    if (cpc > 3.0) {
      suggestions.push({
        type: 'error',
        title: '💸 High Cost Per Click - Budget Inefficiency',
        description: `Your CPC is $${cpc.toFixed(2)}, which is expensive. This impacts your overall ROI and limits reach.`,
        priority: 'high',
        kpi: 'CPC',
        currentValue: `$${cpc.toFixed(2)}`,
        targetValue: '$0.50-$1.50',
        recommendations: [
          '🎯 Bid Strategy: Switch to "Lowest Cost" or "Cost Cap" bid strategy if using "Highest Value"',
          '📊 Quality Score: Improve ad relevance by ensuring landing page matches ad message perfectly',
          '🚫 Negative Targeting: Exclude demographics/interests that click but don\'t convert',
          '⏰ Dayparting: Analyze when your CPC is lowest and focus budget on those hours',
          '📍 Geographic Optimization: Pause high-CPC locations and focus on cost-efficient areas',
          '📱 Placement Optimization: Review placement performance and exclude expensive placements',
          '🔄 Audience Refinement: Tighten targeting to reduce competition and lower costs'
        ],
        impact: 'HIGH - Reducing CPC by 30% can double your reach with same budget'
      })
    } else if (cpc > 1.5 && cpc <= 3.0) {
      suggestions.push({
        type: 'warning',
        title: '💵 Moderate CPC - Room for Improvement',
        description: `Your CPC is $${cpc.toFixed(2)}. This is workable but could be optimized for better efficiency.`,
        priority: 'medium',
        kpi: 'CPC',
        currentValue: `$${cpc.toFixed(2)}`,
        targetValue: '$0.50-$1.50',
        recommendations: [
          '📈 Improve CTR: Higher CTR automatically reduces CPC (they\'re inversely related)',
          '🎯 Audience Testing: Test different audience segments to find lower-cost pockets',
          '🔄 Lookalike Audiences: Use 1% lookalikes for lower CPCs vs broad targeting',
          '📊 Ad Scheduling: Identify and focus on time periods with lower CPCs',
          '🖼️ Creative Refresh: New, engaging creative often leads to lower CPCs'
        ],
        impact: 'MEDIUM - Even 20% CPC reduction significantly improves campaign economics'
      })
    } else if (cpc <= 0.75) {
      suggestions.push({
        type: 'success',
        title: '💚 Excellent Cost Per Click',
        description: `Your CPC of $${cpc.toFixed(2)} is excellent! You\'re acquiring clicks very efficiently.`,
        priority: 'low',
        kpi: 'CPC',
        currentValue: `$${cpc.toFixed(2)}`,
        targetValue: 'Maintain <$1.00',
        recommendations: [
          '📈 Scale Aggressively: With such efficient CPCs, increase budget to maximize reach',
          '🎯 Expand Targeting: Test broader audiences while monitoring CPC',
          '💰 Consider CBO: Campaign Budget Optimization can find more efficient opportunities',
          '📊 Document Success: Note what\'s working for this low CPC for future campaigns'
        ],
        impact: 'Scale efficiently while maintaining low costs'
      })
    }
  }
  
  // ====================
  // CPM OPTIMIZATION
  // ====================
  if (impressions > 1000) {
    if (cpm > 20.0) {
      suggestions.push({
        type: 'warning',
        title: '📢 High CPM - Expensive Impressions',
        description: `Your CPM is $${cpm.toFixed(2)}, indicating high competition or expensive targeting.`,
        priority: 'medium',
        kpi: 'CPM',
        currentValue: `$${cpm.toFixed(2)}`,
        targetValue: '$5-$15',
        recommendations: [
          '🎯 Broaden Targeting: Overly narrow audiences have higher CPMs due to competition',
          '📍 Geographic Expansion: Test less competitive markets or countries',
          '🕐 Avoid Peak Times: CPMs are highest during prime time (evening) and weekends',
          '📊 Placement Strategy: Manual placements often have lower CPMs than automatic',
          '🎨 Improve Relevance Score: Better relevance = lower CPMs from Meta'
        ],
        impact: 'MEDIUM - Lower CPM means more impressions for same budget'
      })
    }
  }
  
  // ====================
  // CONVERSION OPTIMIZATION (Critical for most objectives)
  // ====================
  if (objective && (objective.includes('CONVERSIONS') || objective.includes('OUTCOME'))) {
    if (clicks > 100 && conversions === 0) {
      suggestions.push({
        type: 'error',
        title: '🚨 CRITICAL: Zero Conversions Despite Traffic',
        description: `You have ${clicks} clicks but ZERO conversions. This is a serious issue that needs immediate attention.`,
        priority: 'critical',
        kpi: 'Conversions',
        currentValue: '0',
        targetValue: `${(clicks * 0.02).toFixed(0)}+ (2% conv rate)`,
        recommendations: [
          '🔍 VERIFY PIXEL: Check Meta Events Manager to confirm pixel is firing conversion events',
          '🧪 Test Conversion Manually: Go through your funnel yourself and verify it works',
          '📄 Landing Page Issues: Check page load speed (should be <3 seconds)',
          '🔗 Broken Links: Verify all buttons and links on landing page work correctly',
          '📱 Mobile Experience: 80% of traffic is mobile - test the mobile user experience',
          '💰 Offer/Price Issue: Your offer may not be compelling enough - consider adding incentive',
          '🎯 Traffic Quality: You may be attracting wrong audience - review targeting',
          '⚡ Simplify Funnel: Remove unnecessary steps between click and conversion',
          '💳 Payment Issues: If ecommerce, verify payment gateway is working',
          '🔐 Trust Signals: Add security badges, testimonials, money-back guarantee'
        ],
        impact: 'CRITICAL - This must be fixed immediately or you\'re wasting budget'
      })
    } else if (clicks > 50 && conversions > 0) {
      const actualConvRate = (conversions / clicks) * 100
      
      if (actualConvRate < 1.0) {
        suggestions.push({
          type: 'warning',
          title: '📉 Low Conversion Rate - Funnel Optimization Needed',
          description: `Your conversion rate is ${actualConvRate.toFixed(2)}%, which is below the 2-5% benchmark for paid traffic.`,
          priority: 'high',
          kpi: 'Conversion Rate',
          currentValue: `${actualConvRate.toFixed(2)}%`,
          targetValue: '2-5%',
          recommendations: [
            '🎯 Message Match: Ensure landing page headline matches ad promise exactly',
            '⚡ Page Speed: Use Google PageSpeed Insights - aim for 90+ mobile score',
            '📝 Simplify Forms: Reduce form fields to absolute minimum (name + email)',
            '🎨 Clear CTA: Make your call-to-action button large, contrasting, above the fold',
            '📊 Add Social Proof: Include testimonials, reviews, trust badges, customer logos',
            '🎁 Improve Offer: Test adding urgency ("24hr discount") or reducing friction ("No credit card")',
            '📱 Mobile Optimization: Most traffic is mobile - ensure perfect mobile UX',
            '🎥 Add Video: Landing pages with video convert 80% better',
            '💬 Use Live Chat: Visitors with questions can get instant answers',
            '🔄 A/B Test: Test different headlines, images, CTA copy systematically'
          ],
          impact: 'HIGH - Doubling conversion rate = halving cost per acquisition'
        })
      } else if (actualConvRate >= 2.0 && actualConvRate < 5.0) {
        suggestions.push({
          type: 'success',
          title: '✅ Good Conversion Rate',
          description: `Your ${actualConvRate.toFixed(2)}% conversion rate is solid! With ${conversions} conversions from ${clicks} clicks.`,
          priority: 'low',
          kpi: 'Conversion Rate',
          currentValue: `${actualConvRate.toFixed(2)}%`,
          targetValue: '5%+',
          recommendations: [
            '🔬 Micro-Optimizations: Test small changes (button color, headline) for incremental gains',
            '📈 Scale Gradually: Increase budget by 20% every 3-4 days',
            '🎯 Lookalike Audiences: Create 1% lookalike of converters for similar results',
            '💰 Increase Bid: With good conversion rate, you can bid higher and still be profitable',
            '🧪 Keep Testing: Test variations to push conversion rate even higher'
          ],
          impact: 'Maintain and scale current performance'
        })
      } else if (actualConvRate >= 5.0) {
        suggestions.push({
          type: 'success',
          title: '🌟 Exceptional Conversion Rate!',
          description: `Outstanding ${actualConvRate.toFixed(2)}% conversion rate! This is excellent performance.`,
          priority: 'low',
          kpi: 'Conversion Rate',
          currentValue: `${actualConvRate.toFixed(2)}%`,
          targetValue: 'Maintain 5%+',
          recommendations: [
            '🚀 Scale Aggressively: This is a winning formula - 2-3x the budget',
            '🔄 Duplicate to New Audiences: Test this funnel with similar audiences',
            '📊 Protect This Setup: Document everything that\'s working',
            '💰 Maximize Budget: Increase until you see performance degradation',
            '🎯 Test Premium Placements: You can afford higher CPMs with this conversion rate'
          ],
          impact: 'Scale this winning campaign maximally'
        })
      }
    } else if (clicks > 0 && clicks < 50) {
      suggestions.push({
        type: 'info',
        title: '⏳ More Data Needed',
        description: `With only ${clicks} clicks, we need more data to assess conversion performance accurately.`,
        priority: 'low',
        kpi: 'Data Volume',
        currentValue: `${clicks} clicks`,
        targetValue: '100+ clicks',
        recommendations: [
          '💰 Increase Budget: Need more traffic to get statistical significance',
          '⏱️ Wait 3-5 Days: Let campaign run longer to accumulate data',
          '🎯 Ensure Sufficient Audience: Audience should be at least 50,000 people'
        ],
        impact: 'Need more data before optimization'
      })
    }
  }
  
  // ====================
  // FREQUENCY & AD FATIGUE
  // ====================
  if (frequency > 3.5) {
    suggestions.push({
      type: 'error',
      title: '😴 Ad Fatigue Detected',
      description: `Frequency of ${frequency.toFixed(2)} means people are seeing your ad too many times. Performance will decline rapidly.`,
      priority: 'high',
      kpi: 'Frequency',
      currentValue: frequency.toFixed(2),
      targetValue: '1.5-3.0',
      recommendations: [
        '🎨 URGENT: Refresh Creative ASAP - New images/video are critical',
        '🎯 Expand Audience: Increase audience size to reach new people',
        '💰 Reduce Budget: Lower spend to decrease frequency pressure',
        '🔄 Rotate Creatives: Use Dynamic Creative to show different ads to same people',
        '📊 Set Frequency Cap: Limit impressions to 2-3 per person per 7 days',
        '🎪 New Ad Angles: Try completely different messaging or offers'
      ],
      impact: 'CRITICAL - High frequency kills CTR and increases CPC'
    })
  } else if (frequency >= 2.5 && frequency <= 3.5) {
    suggestions.push({
      type: 'warning',
      title: '⚠️ Approaching Ad Fatigue',
      description: `Frequency of ${frequency.toFixed(2)} is getting high. Plan creative refresh soon.`,
      priority: 'medium',
      kpi: 'Frequency',
      currentValue: frequency.toFixed(2),
      targetValue: '1.5-2.5',
      recommendations: [
        '🎨 Prepare New Creative: Have fresh ads ready to swap in',
        '🎯 Monitor Closely: Watch for CTR decline as early warning sign',
        '📊 Consider Audience Expansion: Bring in new people to reduce frequency',
        '🔄 Test New Angles: Start testing different messaging approaches'
      ],
      impact: 'MEDIUM - Prevent fatigue before it impacts performance'
    })
  }
  
  // ====================
  // REACH & AUDIENCE SIZE
  // ====================
  if (spend > 100 && impressions < 10000) {
    suggestions.push({
      type: 'warning',
      title: '🎯 Limited Reach - Audience Too Small',
      description: `You've spent $${spend.toFixed(2)} but only reached ${reach.toLocaleString()} people. Your audience may be too narrow.`,
      priority: 'medium',
      kpi: 'Reach',
      currentValue: reach.toLocaleString(),
      targetValue: '50,000+',
      recommendations: [
        '🎯 Expand Targeting: Broaden interests or lookalike percentages (1% → 3-5%)',
        '📍 Add Geographies: Include additional countries or regions',
        '👥 Widen Demographics: Expand age range if appropriate',
        '🔍 Remove Narrow Filters: Each additional targeting layer reduces audience significantly',
        '💰 Increase Budget: Higher budget can access larger audience pools'
      ],
      impact: 'MEDIUM - Limited reach constrains growth potential'
    })
  }
  
  // ====================
  // OBJECTIVE-SPECIFIC RECOMMENDATIONS
  // ====================
  
  // ENGAGEMENT Objective
  if (objective && objective.includes('ENGAGEMENT')) {
    suggestions.push({
      type: 'info',
      title: '📊 Engagement Campaign Optimization',
      description: 'Specific tips for engagement objectives (likes, comments, shares).',
      priority: 'medium',
      recommendations: [
        '📸 Use Native Content: Posts that look organic (not ads) get more engagement',
        '❓ Ask Questions: Posts with questions in caption get 4x more comments',
        '🎥 Video Performs Best: Video posts get 135% more organic reach than images',
        '⏰ Post Timing: Test different times - engagement varies by audience',
        '💬 Respond to Comments: Engagement on your replies boosts overall post performance',
        '🎁 Run Contests: "Tag a friend" or "Share to enter" drives engagement',
        '📊 Analyze Top Posts: Double down on content formats that work best'
      ],
      impact: 'Maximize engagement metrics'
    })
  }
  
  // TRAFFIC/LINK CLICK Objective  
  if (objective && (objective.includes('LINK_CLICKS') || objective.includes('TRAFFIC'))) {
    if (inlineLinkClicks > 0 && clicks > 0) {
      const linkClickRatio = (inlineLinkClicks / clicks) * 100
      if (linkClickRatio < 60) {
        suggestions.push({
          type: 'warning',
          title: '🔗 Low Link Click Rate',
          description: `Only ${linkClickRatio.toFixed(0)}% of clicks are going to your website. Many clicks are on "Learn More" or other elements.`,
          priority: 'medium',
          recommendations: [
            '🔗 Clearer CTA: Make it obvious the ad goes to a website',
            '📄 Compelling Preview: Ensure link preview (image/title) is enticing',
            '🎯 Simplify Ad: Remove elements that distract from the main link',
            '💬 Better Copy: Clearly communicate what they\'ll find on the website'
          ],
          impact: 'Improve quality of traffic to your site'
        })
      }
    }
  }
  
  // VIDEO VIEWS Objective
  if (objective && objective.includes('VIDEO')) {
    suggestions.push({
      type: 'info',
      title: '🎥 Video Campaign Best Practices',
      description: 'Optimize your video ads for maximum views and engagement.',
      priority: 'medium',
      recommendations: [
        '⏱️ First 3 Seconds: Make them extremely compelling - most people decide to watch or scroll',
        '📱 Square or Vertical: These formats take more screen space on mobile',
        '💬 Add Captions: 85% watch with sound off - captions increase view time by 12%',
        '⚡ Keep It Short: Videos under 15 seconds have highest completion rates',
        '🎨 Bright & Bold: Eye-catching colors and movement in opening seconds',
        '📊 Analyze Retention: Check where people drop off and improve those moments',
        '🎯 Retarget Viewers: Create audience of people who watched 25%+ for remarketing'
      ],
      impact: 'Maximize video view rate and engagement'
    })
  }
  
  // LEADS Objective
  if (objective && objective.includes('LEAD')) {
    suggestions.push({
      type: 'info',
      title: '📝 Lead Generation Optimization',
      description: 'Maximize quality and quantity of leads.',
      priority: 'high',
      recommendations: [
        '📋 Instant Forms: Use Meta Lead Ads forms instead of sending to website (much higher conversion)',
        '✂️ Minimal Fields: Only ask for essential info (name + email = best conversion)',
        '🎁 Strong Incentive: Offer valuable lead magnet (free guide, discount, template)',
        '✅ Qualification Questions: Add 1-2 qualifying questions to improve lead quality',
        '⚡ Fast Follow-Up: Contact leads within 5 minutes for 10x better conversion',
        '📧 Automated Email: Set up instant automated email with download/info',
        '💰 Calculate LTV: Optimize for lead quality, not just quantity'
      ],
      impact: 'Get more high-quality leads at lower cost'
    })
  }
  
  // ====================
  // BUDGET & SPENDING OPTIMIZATION
  // ====================
  if (campaignData) {
    const dailyBudget = campaignData.daily_budget ? parseFloat(campaignData.daily_budget) / 100 : 0
    const lifetimeBudget = campaignData.lifetime_budget ? parseFloat(campaignData.lifetime_budget) / 100 : 0
    
    if (spend > 0 && conversions > 0) {
      const costPerResult = spend / conversions
      
      if (dailyBudget > 0 && costPerResult < dailyBudget * 0.2) {
        suggestions.push({
          type: 'success',
          title: '💰 Highly Efficient - Scale Opportunity',
          description: `Your cost per result ($${costPerResult.toFixed(2)}) is very low relative to your budget. This campaign can scale!`,
          priority: 'low',
          recommendations: [
            '📈 Increase Budget by 30-50%: Your efficient performance indicates room to scale',
            '🎯 Duplicate to Similar Audiences: Use this winning formula on new audiences',
            '💰 Test Higher Bids: You can bid more aggressively and still be profitable',
            '🔄 Campaign Budget Optimization: Let Meta allocate budget automatically',
            '📊 Monitor Closely: Scale gradually and watch for performance changes'
          ],
          impact: 'Maximize results from this efficient campaign'
        })
      }
    }
    
    if (spend < 50 && impressions < 5000) {
      suggestions.push({
        type: 'info',
        title: '💵 Low Spend - Consider Budget Increase',
        description: 'Your campaign has limited spend and impressions. More budget could improve performance.',
        priority: 'low',
        recommendations: [
          '💰 Increase Daily Budget: Try at least $20-30/day for meaningful data',
          '⏱️ Campaign Learning Phase: Meta needs ~50 conversions/week to optimize',
          '📊 Sufficient Data: More budget = faster learning = better optimization'
        ],
        impact: 'Accelerate learning and optimization'
      })
    }
  }
  
  // ====================
  // GENERAL BEST PRACTICES
  // ====================
  if (suggestions.length === 0) {
    suggestions.push({
      type: 'success',
      title: '✨ Campaign Performing Well',
      description: 'Your campaign metrics are within good ranges. Keep monitoring and testing for continuous improvement.',
      priority: 'low',
      recommendations: [
        '🧪 Continuous Testing: Even good campaigns can be improved - test new creative monthly',
        '📊 Daily Monitoring: Check performance daily for any sudden changes',
        '🎯 Audience Expansion: Test new audience segments while maintaining winners',
        '📖 Document Learnings: Keep notes on what works for future campaigns',
        '💰 Scale Gradually: Increase budget 20% every 3-4 days if performance holds',
        '🔄 Refresh Creative: Plan to update ads every 2-3 weeks to prevent fatigue'
      ],
      impact: 'Maintain good performance and continue optimization'
    })
  }
  
  // Sort suggestions by priority
  const priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 }
  suggestions.sort((a, b) => priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder])
  
  return suggestions
}

// ============================================
// GOOGLE ADS API ROUTES
// ============================================

// Helper function for Google Ads API requests
async function googleAdsRequest(url: string, accessToken: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': 'YOUR_DEVELOPER_TOKEN' // Note: This needs to be configured
      }
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      console.error('Google Ads API Error:', data)
      throw new Error(data.error?.message || JSON.stringify(data))
    }
    
    return data
  } catch (error: any) {
    console.error('Google Ads Request Error:', error)
    throw error
  }
}

// Get Google Ads accounts
app.get('/api/google-ads/accounts', async (c) => {
  try {
    const { GOOGLE_API_KEY } = c.env
    // Note: Google Ads requires OAuth2 authentication, this is a placeholder
    return c.json({ 
      data: [],
      message: 'Google Ads OAuth2 authentication required. Please implement OAuth2 flow.' 
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get Google Ads campaigns
app.get('/api/google-ads/account/:customerId/campaigns', async (c) => {
  try {
    const customerId = c.req.param('customerId')
    // Note: This requires OAuth2 token and proper Google Ads API setup
    return c.json({ 
      data: [],
      message: 'Google Ads API integration in progress. OAuth2 authentication needed.' 
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get Google Ads campaigns (POST endpoint for OAuth2 token)
app.post('/api/google-ads/campaigns', async (c) => {
  try {
    const { access_token, customer_id, days } = await c.req.json()
    
    if (!access_token || !customer_id) {
      return c.json({ 
        success: false,
        error: 'Access token and customer ID are required' 
      }, 400)
    }
    
    // Get date range (default to 30 days)
    const daysAgo = days || 30
    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - daysAgo)
    
    const formatDate = (date) => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    
    const dateRangeStart = formatDate(startDate)
    const dateRangeEnd = formatDate(today)
    
    console.log(`Fetching Google Ads campaigns for customer: ${customer_id}, date range: ${dateRangeStart} to ${dateRangeEnd}`)
    
    // Note: Google Ads API requires a developer token
    const developerToken = c.env.GOOGLE_ADS_DEVELOPER_TOKEN || 'test-token'
    
    // Fetch campaigns with metrics using Google Ads API
    const response = await fetch(`https://googleads.googleapis.com/v16/customers/${customer_id}/googleAds:searchStream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          SELECT 
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign_budget.amount_micros,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.ctr
          FROM campaign
          WHERE campaign.status != 'REMOVED'
            AND segments.date BETWEEN '${dateRangeStart}' AND '${dateRangeEnd}'
          ORDER BY campaign.name
        `
      })
    })
    
    const data = await response.json()
    
    console.log('Google Ads campaigns response:', response.status, data)
    
    if (!response.ok) {
      // Check if it's a developer token issue
      if (data.error?.message?.toLowerCase().includes('developer')) {
        return c.json({
          success: false,
          campaigns: [],
          message: 'Google Ads Developer Token required. Please configure GOOGLE_ADS_DEVELOPER_TOKEN.',
          needsDeveloperToken: true
        })
      }
      
      return c.json({
        success: false,
        campaigns: [],
        error: data.error?.message || 'Failed to fetch campaigns',
        details: data
      }, response.status)
    }
    
    // Parse campaigns from the response and aggregate metrics
    const campaignMap = new Map()
    
    if (data.results) {
      for (const result of data.results) {
        const campaign = result.campaign
        const budget = result.campaignBudget
        const metrics = result.metrics || {}
        
        const campaignId = campaign.id
        
        if (!campaignMap.has(campaignId)) {
          campaignMap.set(campaignId, {
            id: campaignId,
            name: campaign.name,
            status: campaign.status,
            type: campaign.advertisingChannelType,
            budget: budget?.amountMicros ? `$${(budget.amountMicros / 1000000).toFixed(2)}` : 'N/A',
            impressions: 0,
            clicks: 0,
            cost: 0,
            conversions: 0,
            ctr: 0
          })
        }
        
        // Aggregate metrics
        const camp = campaignMap.get(campaignId)
        camp.impressions += parseInt(metrics.impressions || 0)
        camp.clicks += parseInt(metrics.clicks || 0)
        camp.cost += parseInt(metrics.costMicros || 0)
        camp.conversions += parseFloat(metrics.conversions || 0)
      }
    }
    
    // Convert map to array and calculate CTR
    const campaigns = Array.from(campaignMap.values()).map(camp => ({
      ...camp,
      cost: `$${(camp.cost / 1000000).toFixed(2)}`,
      ctr: camp.impressions > 0 ? `${((camp.clicks / camp.impressions) * 100).toFixed(2)}%` : '0.00%',
      conversions: camp.conversions.toFixed(2)
    }))
    
    return c.json({
      success: true,
      campaigns: campaigns,
      count: campaigns.length,
      message: `Successfully fetched ${campaigns.length} campaigns`
    })
  } catch (error: any) {
    console.error('Error fetching Google Ads campaigns:', error)
    return c.json({ 
      success: false,
      error: error.message,
      campaigns: []
    }, 500)
  }
})

// ============================================
// GOOGLE ANALYTICS API ROUTES
// ============================================

// Helper function for Google Analytics API requests
async function googleAnalyticsRequest(url: string, apiKey: string) {
  try {
    const response = await fetch(`${url}&key=${apiKey}`)
    const data = await response.json()
    
    if (!response.ok) {
      console.error('Google Analytics API Error:', data)
      throw new Error(data.error?.message || JSON.stringify(data))
    }
    
    return data
  } catch (error: any) {
    console.error('Google Analytics Request Error:', error)
    throw error
  }
}

// Get Google Analytics accounts
app.get('/api/analytics/accounts', async (c) => {
  try {
    const { GOOGLE_API_KEY } = c.env
    // Note: Google Analytics requires OAuth2 authentication
    return c.json({ 
      data: [],
      message: 'Google Analytics OAuth2 authentication required.' 
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get Analytics report
app.post('/api/analytics/report', async (c) => {
  try {
    const { access_token, property, days } = await c.req.json()
    
    if (!access_token || !property) {
      return c.json({ 
        success: false,
        error: 'Access token and property are required' 
      }, 400)
    }
    
    // Get date range from days parameter (default to 30)
    const daysAgo = days || 30
    const startDate = `${daysAgo}daysAgo`
    
    // Extract property ID from property name (format: properties/123456789)
    const propertyId = property.split('/')[1]
    
    console.log(`Fetching Analytics report for property: ${propertyId}, date range: last ${daysAgo} days`)
    
    // Fetch Analytics data using GA4 Data API
    const reportResponse = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: startDate, endDate: 'today' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViewsPerSession' },
          { name: 'newUsers' },
          { name: 'engagementRate' },
          { name: 'engagedSessions' },
          { name: 'userEngagementDuration' }
        ],
        dimensions: []
      })
    })
    
    const reportData = await reportResponse.json()
    
    console.log('Analytics report response:', reportResponse.status, reportData)
    
    if (!reportResponse.ok) {
      return c.json({
        success: false,
        error: reportData.error?.message || 'Failed to fetch Analytics report',
        details: reportData
      }, reportResponse.status)
    }
    
    // Parse the response
    const row = reportData.rows?.[0]?.metricValues || []
    const totalUsers = parseFloat(row[0]?.value || '0')
    const newUsers = parseFloat(row[6]?.value || '0')
    const engagedSessions = parseFloat(row[8]?.value || '0')
    const totalSessions = parseFloat(row[1]?.value || '0')
    const totalEngagementTime = parseFloat(row[9]?.value || '0')
    
    const metrics = {
      users: Math.round(totalUsers).toLocaleString(),
      sessions: Math.round(parseFloat(row[1]?.value || '0')).toLocaleString(),
      pageViews: Math.round(parseFloat(row[2]?.value || '0')).toLocaleString(),
      bounceRate: (parseFloat(row[3]?.value || '0') * 100).toFixed(2) + '%',
      avgSessionDuration: Math.round(parseFloat(row[4]?.value || '0')) + 's',
      pagesPerSession: parseFloat(row[5]?.value || '0').toFixed(2),
      newUsersPercent: totalUsers > 0 ? ((newUsers / totalUsers) * 100).toFixed(1) + '%' : '0%',
      engagementRate: (parseFloat(row[7]?.value || '0') * 100).toFixed(2) + '%',
      engagedSessions: Math.round(engagedSessions).toLocaleString(),
      avgEngagementTimePerUser: totalUsers > 0 ? Math.round(totalEngagementTime / totalUsers) + 's' : '0s',
      engagementSessionPercent: totalSessions > 0 ? ((engagedSessions / totalSessions) * 100).toFixed(1) + '%' : '0%',
      totalEngagementTime: Math.round(totalEngagementTime),
      // Calculated metrics for comprehensive dashboard
      avgEngagementTimePerSession: totalSessions > 0 ? Math.round(totalEngagementTime / totalSessions) + 's' : '0s',
      returningUsers: Math.round(totalUsers - newUsers).toLocaleString(),
      returningUsersPercent: totalUsers > 0 ? (((totalUsers - newUsers) / totalUsers) * 100).toFixed(1) + '%' : '0%'
    }
    
    return c.json({
      success: true,
      metrics: metrics,
      message: 'Successfully fetched Analytics report'
    })
  } catch (error: any) {
    console.error('Error fetching Analytics report:', error)
    return c.json({ 
      success: false,
      error: error.message 
    }, 500)
  }
})

// ============================================
// GOOGLE OAUTH2 ENDPOINTS
// ============================================

// OAuth2 callback handler
app.get('/oauth2callback', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OAuth2 Callback</title>
    </head>
    <body>
      <script>
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');
        const scope = urlParams.get('scope');
        
        if (error) {
          alert('OAuth2 authentication failed: ' + error);
          window.location.href = '/';
        } else if (code && state) {
          // Store the code and state in sessionStorage
          sessionStorage.setItem('oauth_code', code);
          sessionStorage.setItem('oauth_state', state);
          
          console.log('OAuth callback received - state:', state, 'code:', code.substring(0, 10) + '...');
          
          // Redirect back to main app
          window.location.href = '/';
        } else {
          alert('OAuth2 callback missing required parameters');
          window.location.href = '/';
        }
      </script>
      <div style="text-align: center; padding: 50px; font-family: Arial;">
        <h2>Authentication successful!</h2>
        <p>Redirecting back to application...</p>
      </div>
    </body>
    </html>
  `)
})

// Exchange Google Ads authorization code for access token
app.post('/api/google-ads/oauth2/exchange', async (c) => {
  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env
    const { code } = await c.req.json()
    
    const redirectUri = c.req.header('origin') + '/oauth2callback'
    
    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })
    
    const tokens = await tokenResponse.json()
    
    if (!tokenResponse.ok) {
      throw new Error(tokens.error_description || 'Failed to exchange code for token')
    }
    
    // TODO: Store tokens securely (use KV storage or database)
    // For now, return the access token to frontend (temporary solution)
    
    return c.json({ 
      success: true,
      message: 'Google Ads authenticated successfully',
      access_token: tokens.access_token, // Temporary - should be stored server-side
      refresh_token: tokens.refresh_token
    })
  } catch (error: any) {
    console.error('OAuth2 exchange error:', error)
    return c.json({ error: error.message }, 500)
  }
})

// Exchange Google Analytics authorization code for access token
app.post('/api/analytics/oauth2/exchange', async (c) => {
  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env
    const { code } = await c.req.json()
    
    const redirectUri = c.req.header('origin') + '/oauth2callback'
    
    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })
    
    const tokens = await tokenResponse.json()
    
    if (!tokenResponse.ok) {
      throw new Error(tokens.error_description || 'Failed to exchange code for token')
    }
    
    // TODO: Store tokens securely (use KV storage or database)
    // For now, return the access token to frontend (temporary solution)
    
    return c.json({ 
      success: true,
      message: 'Google Analytics authenticated successfully',
      access_token: tokens.access_token, // Temporary - should be stored server-side
      refresh_token: tokens.refresh_token
    })
  } catch (error: any) {
    console.error('OAuth2 exchange error:', error)
    return c.json({ error: error.message }, 500)
  }
})

// Get Google Ads accessible customers (accounts)
app.post('/api/google-ads/customers', async (c) => {
  try {
    const { access_token } = await c.req.json()
    
    if (!access_token) {
      return c.json({ error: 'Access token required' }, 400)
    }
    
    // Check if developer token is configured
    if (!c.env.GOOGLE_ADS_DEVELOPER_TOKEN || c.env.GOOGLE_ADS_DEVELOPER_TOKEN === 'YOUR_DEVELOPER_TOKEN_HERE') {
      return c.json({
        success: false,
        accounts: [],
        error: 'Google Ads Developer Token is required',
        message: '⚠️ Missing Developer Token\n\nTo use Google Ads API, you need to:\n\n1. Apply for a Developer Token at:\n   https://ads.google.com/aw/apicenter\n\n2. Add the token to your .dev.vars file:\n   GOOGLE_ADS_DEVELOPER_TOKEN=your-token-here\n\n3. Restart the application\n\nNote: New tokens are in "test" mode and can only access test accounts initially.',
        needsDeveloperToken: true
      })
    }
    
    // Note: Google Ads API requires a developer token
    // Use the correct endpoint without version in path
    const response = await fetch('https://googleads.googleapis.com/v17/customers:listAccessibleCustomers', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'developer-token': c.env.GOOGLE_ADS_DEVELOPER_TOKEN
      }
    })
    
    // Check content type to handle HTML error responses
    const contentType = response.headers.get('content-type') || ''
    let data
    
    if (contentType.includes('application/json')) {
      data = await response.json()
    } else {
      // Handle non-JSON responses (like HTML error pages)
      const text = await response.text()
      console.error('Google Ads API returned non-JSON response:', response.status, text.substring(0, 200))
      
      // Check if it's a 404 (API not enabled)
      if (response.status === 404) {
        return c.json({
          success: false,
          accounts: [],
          error: 'Google Ads API is not enabled or accessible',
          message: '❌ Google Ads API Error: The Google Ads API is not enabled for your project.\n\nTo fix this:\n1. Go to: https://console.cloud.google.com/apis/library/googleads.googleapis.com\n2. Click "ENABLE"\n3. Wait 2-3 minutes\n4. Retry connecting',
          needsApiEnabled: true
        })
      }
      
      return c.json({
        success: false,
        accounts: [],
        error: 'Google Ads API returned an error. This usually means authentication failed or the Developer Token is invalid.',
        message: 'Please check: 1) OAuth token is valid, 2) Developer Token is configured correctly, 3) Google Ads API is enabled',
        httpStatus: response.status
      }, 500)
    }
    
    console.log('Google Ads API Response:', response.status, data)
    
    if (!response.ok) {
      // If developer token is missing, return a helpful message
      if (data.error?.message?.includes('developer') || data.error?.message?.includes('DEVELOPER_TOKEN')) {
        return c.json({
          success: false,
          accounts: [],
          message: 'Google Ads Developer Token required. Please add GOOGLE_ADS_DEVELOPER_TOKEN to environment variables.',
          needsDeveloperToken: true
        })
      }
      // Return error details for debugging
      return c.json({
        success: false,
        accounts: [],
        error: data.error?.message || 'Failed to fetch customers',
        details: data
      }, response.status)
    }
    
    return c.json({
      success: true,
      accounts: data.resourceNames || [],
      count: (data.resourceNames || []).length,
      message: 'Successfully fetched Google Ads accounts'
    })
  } catch (error: any) {
    console.error('Error fetching Google Ads customers:', error)
    return c.json({ 
      success: false,
      error: error.message,
      message: 'Failed to fetch Google Ads accounts. Please check authentication and API configuration.',
      accounts: []
    }, 500)
  }
})

// Get Google Analytics properties
app.post('/api/analytics/properties', async (c) => {
  try {
    const { access_token } = await c.req.json()
    
    if (!access_token) {
      return c.json({ error: 'Access token required' }, 400)
    }
    
    // Fetch Analytics accounts first
    const accountsResponse = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    })
    
    const accountsData = await accountsResponse.json()
    
    console.log('Google Analytics API Response:', accountsResponse.status, accountsData)
    
    if (!accountsResponse.ok) {
      return c.json({
        success: false,
        properties: [],
        error: accountsData.error?.message || 'Failed to fetch Analytics accounts',
        details: accountsData
      }, accountsResponse.status)
    }
    
    // Extract properties from account summaries
    const properties = []
    if (accountsData.accountSummaries) {
      for (const account of accountsData.accountSummaries) {
        if (account.propertySummaries) {
          for (const prop of account.propertySummaries) {
            properties.push({
              name: prop.property,
              displayName: prop.displayName,
              account: account.displayName
            })
          }
        }
      }
    }
    
    return c.json({
      success: true,
      properties: properties,
      count: properties.length,
      message: `Successfully fetched ${properties.length} Analytics properties`
    })
  } catch (error: any) {
    console.error('Error fetching Analytics properties:', error)
    return c.json({ 
      success: false,
      error: error.message,
      properties: []
    }, 500)
  }
})

// Main route - Serve the frontend
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PinPointer - Multi-Platform Ads Intelligence</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              'pinpoint-pink': '#E63462',
              'pinpoint-red': '#C91F45',
              'pinpoint-dark': '#A01835',
              'pinpoint-light': '#FF6B8A',
            }
          }
        }
      }
    </script>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
      .glass-effect {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      .metric-card {
        transition: all 0.3s ease;
      }
      .metric-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
      }
      .loading {
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: .5; }
      }
      .sidebar {
        min-height: 100vh;
        background: white;
        box-shadow: 2px 0 10px rgba(0,0,0,0.1);
        border-right: 1px solid #e5e7eb;
      }
      .logo-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .kpi-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        background: rgba(255,255,255,0.2);
        margin-top: 4px;
      }
    </style>
</head>
<body class="bg-gradient-to-br from-gray-50 via-pink-50 to-red-50">
    <div class="flex">
        <!-- Sidebar -->
        <div class="sidebar w-64 p-6 text-gray-800">
            <div class="mb-8">
                <div class="flex items-center mb-2">
                    <div class="logo-container mr-3">
                        <img src="/static/pinpointer-logo.jpg" alt="PinPointer" class="w-12 h-12 object-contain">
                    </div>
                    <div>
                        <h1 class="text-2xl font-bold text-pinpoint-pink">PinPointer</h1>
                        <p class="text-sm text-gray-600">Multi-Platform Intelligence</p>
                    </div>
                </div>
            </div>
            
            <nav class="space-y-2">
                <button onclick="showTab('meta')" id="tab-meta" class="tab-button w-full text-left block px-4 py-3 rounded-lg bg-pinpoint-pink text-white hover:bg-pinpoint-red transition">
                    <i class="fab fa-facebook mr-2"></i> Meta Ads
                </button>
                <button onclick="showTab('google-ads')" id="tab-google-ads" class="tab-button w-full text-left block px-4 py-3 rounded-lg hover:bg-gray-100 transition text-gray-700">
                    <i class="fab fa-google mr-2"></i> Google Ads
                </button>
                <button onclick="showTab('analytics')" id="tab-analytics" class="tab-button w-full text-left block px-4 py-3 rounded-lg hover:bg-gray-100 transition text-gray-700">
                    <i class="fas fa-chart-line mr-2"></i> Google Analytics
                </button>
                <button onclick="showTab('tiktok')" id="tab-tiktok" class="tab-button w-full text-left block px-4 py-3 rounded-lg hover:bg-gray-100 transition text-gray-700">
                    <i class="fab fa-tiktok mr-2"></i> TikTok Ads
                </button>
            </nav>
            
            <div class="mt-auto pt-8">
                <div class="px-4 py-3 bg-gray-100 rounded-lg">
                    <p class="text-xs text-gray-600">Platforms Connected</p>
                    <p class="text-sm font-semibold text-gray-800">4 Networks</p>
                </div>
            </div>
        </div>
        
        <!-- Main Content -->
        <div class="flex-1 p-8">
            
            <!-- META ADS TAB -->
            <div id="content-meta" class="tab-content">
                <!-- Header -->
                <div class="mb-8">
                    <div class="flex items-center justify-between mb-6">
                        <div>
                            <h2 class="text-3xl font-bold text-gray-800">Meta Ads Dashboard</h2>
                            <p class="text-gray-600 mt-1">Monitor and optimize your Facebook & Instagram campaigns with AI-powered insights</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            <select id="dateRange" class="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-pinpoint-pink">
                                <option value="today">Today</option>
                                <option value="yesterday">Yesterday</option>
                                <option value="last_7d">Last 7 Days</option>
                                <option value="last_30d" selected>Last 30 Days</option>
                                <option value="this_month">This Month</option>
                                <option value="last_month">Last Month</option>
                            </select>
                            <button onclick="refreshData()" class="px-4 py-2 bg-pinpoint-pink text-white rounded-lg hover:bg-pinpoint-red transition shadow-md">
                                <i class="fas fa-sync-alt mr-2"></i> Refresh
                            </button>
                        </div>
                    </div>
                    
                    <!-- Ad Account Selector -->
                    <div class="glass-effect rounded-xl p-6 mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            <i class="fas fa-user-circle mr-2"></i> Select Ad Account
                        </label>
                        <select id="adAccountSelect" onchange="loadCampaigns()" 
                                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pinpoint-pink">
                            <option value="">Loading ad accounts...</option>
                        </select>
                    </div>
                </div>
                
                <!-- Campaign List -->
                <div id="campaignsList" class="space-y-6">
                    <!-- Campaigns will be loaded here -->
                    <div class="text-center py-12">
                        <div class="loading">
                            <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
                            <p class="mt-4 text-gray-600">Select an ad account to view campaigns</p>
                        </div>
                    </div>
                </div>
                
                <!-- Optimization Suggestions Modal -->
                <div id="optimizationModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div class="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
                        <div class="sticky top-0 bg-white p-6 border-b z-10">
                            <div class="flex items-center justify-between">
                                <h3 class="text-2xl font-bold text-gray-800">
                                    <i class="fas fa-magic mr-2 text-pinpoint-pink"></i>
                                    AI Optimization Suggestions
                                </h3>
                                <button onclick="closeOptimizationModal()" class="text-gray-500 hover:text-gray-700">
                                    <i class="fas fa-times text-2xl"></i>
                                </button>
                            </div>
                            <p class="text-sm text-gray-600 mt-2">
                                <i class="fas fa-info-circle mr-1"></i>
                                These are recommendations only. Review and implement them manually in Meta Ads Manager.
                            </p>
                        </div>
                        <div id="optimizationContent" class="p-6">
                            <!-- Suggestions will be loaded here -->
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- GOOGLE ADS TAB -->
            <div id="content-google-ads" class="tab-content hidden">
                <div class="mb-8">
                    <h2 class="text-3xl font-bold text-gray-800">Google Ads Dashboard</h2>
                    <p class="text-gray-600 mt-1">Manage and optimize your Google Ads campaigns</p>
                </div>
                
                <!-- Not Connected State -->
                <div id="google-ads-connect" class="glass-effect rounded-xl p-6">
                    <div class="text-center py-12">
                        <i class="fab fa-google text-6xl text-blue-500 mb-4"></i>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">Google Ads Integration</h3>
                        <p class="text-gray-600 mb-4">Complete OAuth2 authentication to access Google Ads campaigns</p>
                        <button onclick="authenticateGoogleAds()" class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
                            <i class="fas fa-sign-in-alt mr-2"></i> Connect Google Ads Account
                        </button>
                    </div>
                </div>
                
                <!-- Connected State -->
                <div id="google-ads-dashboard" class="hidden">
                    <div class="glass-effect rounded-xl p-6 mb-6">
                        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <h3 class="text-lg font-bold text-gray-800">
                                    <i class="fas fa-check-circle text-green-500 mr-2"></i>
                                    Connected to Google Ads
                                </h3>
                                <p class="text-sm text-gray-600 mt-1">Select account and date range to view campaigns</p>
                            </div>
                            <div class="flex items-center space-x-2">
                                <select id="googleAdsDateRange" onchange="loadGoogleAdsCampaigns()" class="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                                    <option value="7">Last 7 Days</option>
                                    <option value="14">Last 14 Days</option>
                                    <option value="30" selected>Last 30 Days</option>
                                    <option value="60">Last 60 Days</option>
                                    <option value="90">Last 90 Days</option>
                                </select>
                                <button onclick="loadGoogleAdsCampaigns()" class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm">
                                    <i class="fas fa-sync-alt mr-2"></i> Refresh
                                </button>
                                <button onclick="disconnectGoogleAds()" class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-sm">
                                    <i class="fas fa-sign-out-alt mr-2"></i> Disconnect
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="glass-effect rounded-xl p-6">
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            <i class="fab fa-google mr-2"></i> Select Google Ads Account
                        </label>
                        <select id="googleAdsAccountSelect" onchange="loadGoogleAdsCampaigns()" 
                                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">Loading accounts...</option>
                        </select>
                    </div>
                    
                    <div id="googleAdsCampaignsList" class="mt-6 space-y-6">
                        <div class="text-center py-12">
                            <div class="loading">
                                <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
                                <p class="mt-4 text-gray-600">Select an account to view campaigns</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- GOOGLE ANALYTICS TAB -->
            <div id="content-analytics" class="tab-content hidden">
                <div class="mb-8">
                    <h2 class="text-3xl font-bold text-gray-800">Google Analytics Dashboard</h2>
                    <p class="text-gray-600 mt-1">Comprehensive reports and insights from your website data</p>
                </div>
                
                <!-- Not Connected State -->
                <div id="analytics-connect" class="glass-effect rounded-xl p-6 mb-6">
                    <div class="text-center py-12">
                        <i class="fas fa-chart-line text-6xl text-orange-500 mb-4"></i>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">Google Analytics Integration</h3>
                        <p class="text-gray-600 mb-4">Connect your Google Analytics account to view reports and insights</p>
                        <button onclick="authenticateGoogleAnalytics()" class="px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition">
                            <i class="fas fa-sign-in-alt mr-2"></i> Connect Analytics Account
                        </button>
                    </div>
                </div>
                
                <!-- Connected State -->
                <div id="analytics-dashboard" class="hidden">
                    <div class="glass-effect rounded-xl p-6 mb-6">
                        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <h3 class="text-lg font-bold text-gray-800">
                                    <i class="fas fa-check-circle text-green-500 mr-2"></i>
                                    Connected to Google Analytics
                                </h3>
                                <p class="text-sm text-gray-600 mt-1">Select property and date range to view insights</p>
                            </div>
                            <div class="flex items-center space-x-2">
                                <select id="analyticsDateRange" onchange="loadAnalyticsData()" class="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm">
                                    <option value="7">Last 7 Days</option>
                                    <option value="14">Last 14 Days</option>
                                    <option value="30" selected>Last 30 Days</option>
                                    <option value="60">Last 60 Days</option>
                                    <option value="90">Last 90 Days</option>
                                </select>
                                <button onclick="loadAnalyticsData()" class="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition text-sm">
                                    <i class="fas fa-sync-alt mr-2"></i> Refresh
                                </button>
                                <button onclick="disconnectAnalytics()" class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-sm">
                                    <i class="fas fa-sign-out-alt mr-2"></i> Disconnect
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="glass-effect rounded-xl p-6">
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            <i class="fas fa-chart-line mr-2"></i> Select Analytics Property
                        </label>
                        <select id="analyticsPropertySelect" onchange="loadAnalyticsData()" 
                                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                            <option value="">Loading properties...</option>
                        </select>
                    </div>
                    
                    <div id="analyticsDataContainer" class="mt-6">
                        <div class="text-center py-12">
                            <div class="loading">
                                <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
                                <p class="mt-4 text-gray-600">Select a property to view data</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- TIKTOK ADS TAB -->
            <div id="content-tiktok" class="tab-content hidden">
                <div class="mb-8">
                    <h2 class="text-3xl font-bold text-gray-800">TikTok Ads Dashboard</h2>
                    <p class="text-gray-600 mt-1">Manage and optimize your TikTok advertising campaigns</p>
                </div>
                
                <div class="glass-effect rounded-xl p-6">
                    <div class="text-center py-12">
                        <i class="fab fa-tiktok text-6xl text-gray-800 mb-4"></i>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">TikTok Ads Integration</h3>
                        <p class="text-gray-600 mb-4">TikTok Ads API integration coming soon</p>
                        <button disabled class="px-6 py-3 bg-gray-400 text-white rounded-lg cursor-not-allowed">
                            <i class="fas fa-clock mr-2"></i> Coming Soon
                        </button>
                        <p class="text-sm text-gray-500 mt-4">API credentials will be configured once provided</p>
                    </div>
                </div>
            </div>
            
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        let currentAccount = null;
        let campaigns = [];
        
        // Tab switching functionality
        function showTab(tabName) {
            // Hide all tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            
            // Remove active state from all tab buttons
            document.querySelectorAll('.tab-button').forEach(button => {
                button.classList.remove('bg-pinpoint-pink', 'text-white');
                button.classList.add('text-gray-700', 'hover:bg-gray-100');
            });
            
            // Show selected tab content
            document.getElementById('content-' + tabName).classList.remove('hidden');
            
            // Add active state to selected tab button
            const activeButton = document.getElementById('tab-' + tabName);
            activeButton.classList.add('bg-pinpoint-pink', 'text-white');
            activeButton.classList.remove('text-gray-700', 'hover:bg-gray-100');
        }
        
        // Google Ads authentication
        function authenticateGoogleAds() {
            const clientId = '312345908119-1ucadmou91if715jps8sdkjujhvifnfc.apps.googleusercontent.com';
            const redirectUri = window.location.origin + '/oauth2callback';
            const scope = 'https://www.googleapis.com/auth/adwords';
            
            // Save current state
            sessionStorage.setItem('oauth_service', 'google-ads');
            sessionStorage.setItem('return_tab', 'google-ads');
            
            const authUrl = \`https://accounts.google.com/o/oauth2/v2/auth?\` +
                \`client_id=\${encodeURIComponent(clientId)}&\` +
                \`redirect_uri=\${encodeURIComponent(redirectUri)}&\` +
                \`response_type=code&\` +
                \`scope=\${encodeURIComponent(scope)}&\` +
                \`access_type=offline&\` +
                \`prompt=consent&\` +
                \`state=google-ads\`;
            
            console.log('PinPointer: Redirecting to Google Ads OAuth...');
            
            // Redirect entire page to Google OAuth (avoids popup/iframe blocking)
            window.location.href = authUrl;
        }
        
        // Google Analytics authentication
        function authenticateGoogleAnalytics() {
            const clientId = '312345908119-1ucadmou91if715jps8sdkjujhvifnfc.apps.googleusercontent.com';
            const redirectUri = window.location.origin + '/oauth2callback';
            const scope = 'https://www.googleapis.com/auth/analytics.readonly';
            
            console.log('PinPointer: Starting Google Analytics OAuth');
            console.log('PinPointer: Redirect URI:', redirectUri);
            
            const authUrl = \`https://accounts.google.com/o/oauth2/v2/auth?\` +
                \`client_id=\${encodeURIComponent(clientId)}&\` +
                \`redirect_uri=\${encodeURIComponent(redirectUri)}&\` +
                \`response_type=code&\` +
                \`scope=\${encodeURIComponent(scope)}&\` +
                \`access_type=offline&\` +
                \`prompt=consent&\` +
                \`state=google-analytics\`;
            
            console.log('PinPointer: Auth URL:', authUrl);
            
            // Save current state
            sessionStorage.setItem('oauth_service', 'google-analytics');
            sessionStorage.setItem('return_tab', 'analytics');
            
            console.log('PinPointer: Redirecting to Google OAuth...');
            
            // Redirect entire page to Google OAuth (avoids popup/iframe blocking)
            window.location.href = authUrl;
        }
        
        async function exchangeGoogleAdsCode(code) {
            try {
                console.log('PinPointer: Exchanging Google Ads code...');
                const response = await axios.post('/api/google-ads/oauth2/exchange', { code });
                if (response.data.success) {
                    console.log('PinPointer: Google Ads connected successfully!');
                    
                    // Store access token (temporary - should be server-side in production)
                    localStorage.setItem('google_ads_token', response.data.access_token);
                    localStorage.setItem('google_ads_connected', 'true');
                    
                    // Hide connect screen, show dashboard
                    document.getElementById('google-ads-connect').classList.add('hidden');
                    document.getElementById('google-ads-dashboard').classList.remove('hidden');
                    
                    // Load Google Ads accounts
                    loadGoogleAdsAccounts();
                }
            } catch (error) {
                console.error('Error exchanging Google Ads code:', error);
                alert('Failed to connect Google Ads. Please try again.');
            }
        }
        
        async function exchangeGoogleAnalyticsCode(code) {
            try {
                console.log('PinPointer: Exchanging Google Analytics code...');
                const response = await axios.post('/api/analytics/oauth2/exchange', { code });
                if (response.data.success) {
                    console.log('PinPointer: Google Analytics connected successfully!');
                    
                    // Store access token (temporary - should be server-side in production)
                    localStorage.setItem('google_analytics_token', response.data.access_token);
                    localStorage.setItem('google_analytics_connected', 'true');
                    
                    // Hide connect screen, show dashboard
                    document.getElementById('analytics-connect').classList.add('hidden');
                    document.getElementById('analytics-dashboard').classList.remove('hidden');
                    
                    // Load Analytics properties
                    loadAnalyticsProperties();
                }
            } catch (error) {
                console.error('Error exchanging Google Analytics code:', error);
                alert('Failed to connect Google Analytics. Please try again.');
            }
        }
        
        async function loadGoogleAdsAccounts() {
            try {
                console.log('PinPointer: Loading Google Ads accounts...');
                const token = localStorage.getItem('google_ads_token');
                const select = document.getElementById('googleAdsAccountSelect');
                
                if (!token) {
                    select.innerHTML = '<option value="">No access token found</option>';
                    return;
                }
                
                select.innerHTML = '<option value="">Loading accounts...</option>';
                
                const response = await axios.post('/api/google-ads/customers', { 
                    access_token: token 
                });
                
                console.log('PinPointer: Google Ads accounts response:', response.data);
                
                if (response.data.success && response.data.accounts && response.data.accounts.length > 0) {
                    select.innerHTML = '<option value="">Select an account...</option>';
                    response.data.accounts.forEach(account => {
                        const option = document.createElement('option');
                        // Extract customer ID from resource name (format: customers/1234567890)
                        const customerId = account.split('/')[1];
                        option.value = customerId;
                        option.textContent = \`Customer ID: \${customerId}\`;
                        select.appendChild(option);
                    });
                } else if (response.data.needsDeveloperToken) {
                    select.innerHTML = '<option value="">Developer Token Required - See Console</option>';
                    console.warn('PinPointer:', response.data.message);
                    alert(response.data.message + '\\n\\nYou need to apply for a Google Ads Developer Token at https://ads.google.com/');
                } else {
                    select.innerHTML = '<option value="">No accounts found</option>';
                }
            } catch (error) {
                console.error('Error loading Google Ads accounts:', error);
                const select = document.getElementById('googleAdsAccountSelect');
                select.innerHTML = '<option value="">Error loading accounts</option>';
            }
        }
        
        async function loadAnalyticsProperties() {
            try {
                console.log('PinPointer: Loading Analytics properties...');
                const token = localStorage.getItem('google_analytics_token');
                const select = document.getElementById('analyticsPropertySelect');
                
                if (!token) {
                    select.innerHTML = '<option value="">No access token found</option>';
                    return;
                }
                
                select.innerHTML = '<option value="">Loading properties...</option>';
                
                const response = await axios.post('/api/analytics/properties', { 
                    access_token: token 
                });
                
                console.log('PinPointer: Analytics properties response:', response.data);
                
                if (response.data.success && response.data.properties && response.data.properties.length > 0) {
                    select.innerHTML = '<option value="">Select a property...</option>';
                    response.data.properties.forEach(property => {
                        const option = document.createElement('option');
                        option.value = property.name;
                        option.textContent = \`\${property.displayName} (\${property.account})\`;
                        select.appendChild(option);
                    });
                } else {
                    select.innerHTML = '<option value="">No properties found</option>';
                }
            } catch (error) {
                console.error('Error loading Analytics properties:', error);
                const select = document.getElementById('analyticsPropertySelect');
                select.innerHTML = '<option value="">Error loading properties</option>';
            }
        }
        
        async function loadGoogleAdsCampaigns() {
            const customerId = document.getElementById('googleAdsAccountSelect').value;
            const days = parseInt(document.getElementById('googleAdsDateRange').value) || 30;
            const container = document.getElementById('googleAdsCampaignsList');
            
            if (!customerId) {
                container.innerHTML = '<div class="text-center py-12"><div class="loading"><i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i><p class="mt-4 text-gray-600">Select an account to view campaigns</p></div></div>';
                return;
            }
            
            try {
                console.log('PinPointer: Loading Google Ads campaigns for customer: ' + customerId + ', last ' + days + ' days');
                container.innerHTML = '<div class="text-center py-12"><div class="loading"><i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i><p class="mt-4 text-gray-600">Loading campaigns...</p></div></div>';
                
                const token = localStorage.getItem('google_ads_token');
                const response = await axios.post('/api/google-ads/campaigns', {
                    access_token: token,
                    customer_id: customerId,
                    days: days
                });
                
                console.log('PinPointer: Google Ads campaigns response:', response.data);
                
                if (response.data.success && response.data.campaigns && response.data.campaigns.length > 0) {
                    const dateRangeText = days === 7 ? '7 Days' : days === 14 ? '14 Days' : days === 30 ? '30 Days' : days === 60 ? '60 Days' : '90 Days';
                    let html = '<div class="mb-4 text-sm text-gray-600"><i class="fas fa-calendar mr-2"></i>Showing data for last ' + dateRangeText + '</div>';
                    html += '<div class="space-y-4">';
                    response.data.campaigns.forEach(campaign => {
                        html += '<div class="glass-effect rounded-xl p-6 hover:shadow-lg transition">' +
                                '<div class="flex items-start justify-between mb-4"><div class="flex-1">' +
                                '<h4 class="text-lg font-bold text-gray-800">' + (campaign.name || 'Unnamed Campaign') + '</h4>' +
                                '<p class="text-sm text-gray-500 mt-1"><span class="inline-block px-2 py-1 rounded ' + 
                                (campaign.status === 'ENABLED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700') + '">' + 
                                (campaign.status || 'N/A') + '</span> <span class="ml-2 text-gray-400">•</span> <span class="ml-2">' + 
                                (campaign.type || 'N/A') + '</span></p>' +
                                '</div></div>' +
                                '<div class="grid grid-cols-2 md:grid-cols-6 gap-3">' +
                                '<div class="text-center p-3 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg"><p class="text-xs text-gray-600 mb-1">Impressions</p>' +
                                '<p class="text-lg font-bold text-blue-600">' + (campaign.impressions?.toLocaleString() || '0') + '</p></div>' +
                                '<div class="text-center p-3 bg-gradient-to-br from-green-50 to-green-100 rounded-lg"><p class="text-xs text-gray-600 mb-1">Clicks</p>' +
                                '<p class="text-lg font-bold text-green-600">' + (campaign.clicks?.toLocaleString() || '0') + '</p></div>' +
                                '<div class="text-center p-3 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg"><p class="text-xs text-gray-600 mb-1">CTR</p>' +
                                '<p class="text-lg font-bold text-purple-600">' + (campaign.ctr || '0.00%') + '</p></div>' +
                                '<div class="text-center p-3 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg"><p class="text-xs text-gray-600 mb-1">Spend</p>' +
                                '<p class="text-lg font-bold text-orange-600">' + (campaign.cost || '$0.00') + '</p></div>' +
                                '<div class="text-center p-3 bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg"><p class="text-xs text-gray-600 mb-1">Conversions</p>' +
                                '<p class="text-lg font-bold text-pink-600">' + (campaign.conversions || '0') + '</p></div>' +
                                '<div class="text-center p-3 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg"><p class="text-xs text-gray-600 mb-1">Budget</p>' +
                                '<p class="text-lg font-bold text-indigo-600">' + (campaign.budget || 'N/A') + '</p></div>' +
                                '</div></div>';
                    });
                    html += '</div>';
                    container.innerHTML = html;
                } else {
                    const msg = response.data.message || '';
                    container.innerHTML = '<div class="glass-effect rounded-xl p-12 text-center">' +
                                        '<i class="fas fa-inbox text-6xl text-gray-300 mb-4"></i>' +
                                        '<h3 class="text-xl font-bold text-gray-800 mb-2">No Campaigns Found</h3>' +
                                        "<p class='text-gray-600'>This account doesn't have any campaigns yet.</p>" +
                                        (msg ? '<p class="text-sm text-gray-500 mt-2">' + msg + '</p>' : '') + '</div>';
                }
            } catch (error) {
                console.error('Error loading Google Ads campaigns:', error);
                const errMsg = (error.response && error.response.data && error.response.data.error) || error.message || 'Failed to load campaigns';
                container.innerHTML = '<div class="glass-effect rounded-xl p-12 text-center">' +
                                    '<i class="fas fa-exclamation-circle text-6xl text-red-400 mb-4"></i>' +
                                    '<h3 class="text-xl font-bold text-gray-800 mb-2">Error Loading Campaigns</h3>' +
                                    '<p class="text-gray-600">' + errMsg + '</p>' +
                                    '<button onclick="loadGoogleAdsCampaigns()" class="mt-4 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">' +
                                    '<i class="fas fa-redo mr-2"></i> Retry</button></div>';
            }
        }
        
        async function loadAnalyticsData() {
            const propertyName = document.getElementById('analyticsPropertySelect').value;
            const days = parseInt(document.getElementById('analyticsDateRange').value) || 30;
            const container = document.getElementById('analyticsDataContainer');
            
            if (!propertyName) {
                container.innerHTML = '<div class="text-center py-12"><div class="loading"><i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i><p class="mt-4 text-gray-600">Select a property to view data</p></div></div>';
                return;
            }
            
            try {
                console.log('PinPointer: Loading Analytics data for property: ' + propertyName + ', last ' + days + ' days');
                container.innerHTML = '<div class="text-center py-12"><div class="loading"><i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i><p class="mt-4 text-gray-600">Loading analytics data...</p></div></div>';
                
                const token = localStorage.getItem('google_analytics_token');
                const response = await axios.post('/api/analytics/report', {
                    access_token: token,
                    property: propertyName,
                    days: days
                });
                
                console.log('PinPointer: Analytics data response:', response.data);
                
                if (response.data.success && response.data.metrics) {
                    const m = response.data.metrics;
                    const dateRangeText = days === 7 ? '7 Days' : days === 14 ? '14 Days' : days === 30 ? '30 Days' : days === 60 ? '60 Days' : '90 Days';
                    container.innerHTML = '<div class="space-y-6">' +
                        // Key Metrics Section
                        '<div class="glass-effect rounded-xl p-6"><h3 class="text-xl font-bold text-gray-800 mb-4"><i class="fas fa-chart-line mr-2 text-pinpoint-pink"></i> Key Metrics (Last ' + dateRangeText + ')</h3>' +
                        '<div class="grid grid-cols-2 md:grid-cols-4 gap-4">' +
                        '<div class="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-sm hover:shadow-md transition"><p class="text-sm text-gray-600 mb-1 font-semibold">Total Users</p><p class="text-3xl font-bold text-blue-600">' + (m.users || '0') + '</p></div>' +
                        '<div class="text-center p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow-sm hover:shadow-md transition"><p class="text-sm text-gray-600 mb-1 font-semibold">Sessions</p><p class="text-3xl font-bold text-green-600">' + (m.sessions || '0') + '</p></div>' +
                        '<div class="text-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow-sm hover:shadow-md transition"><p class="text-sm text-gray-600 mb-1 font-semibold">Page Views</p><p class="text-3xl font-bold text-purple-600">' + (m.pageViews || '0') + '</p></div>' +
                        '<div class="text-center p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg shadow-sm hover:shadow-md transition"><p class="text-sm text-gray-600 mb-1 font-semibold">Bounce Rate</p><p class="text-3xl font-bold text-orange-600">' + (m.bounceRate || '0%') + '</p></div>' +
                        '</div></div>' +
                        
                        // User Insights Section
                        '<div class="glass-effect rounded-xl p-6"><h3 class="text-xl font-bold text-gray-800 mb-4"><i class="fas fa-users mr-2 text-blue-500"></i> User Insights</h3>' +
                        '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
                        '<div class="p-5 bg-gradient-to-br from-blue-50 to-cyan-100 rounded-lg shadow-sm"><div class="flex items-center justify-between mb-2"><p class="text-sm text-gray-600 font-semibold">New Users</p><i class="fas fa-user-plus text-blue-400 text-xl"></i></div><p class="text-3xl font-bold text-blue-700">' + (m.newUsersPercent || '0%') + '</p><p class="text-xs text-gray-500 mt-1">First-time visitors</p></div>' +
                        '<div class="p-5 bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg shadow-sm"><div class="flex items-center justify-between mb-2"><p class="text-sm text-gray-600 font-semibold">Returning Users</p><i class="fas fa-user-check text-green-400 text-xl"></i></div><p class="text-3xl font-bold text-green-700">' + (m.returningUsersPercent || '0%') + '</p><p class="text-xs text-gray-500 mt-1">' + (m.returningUsers || '0') + ' returning visitors</p></div>' +
                        '<div class="p-5 bg-gradient-to-br from-purple-50 to-violet-100 rounded-lg shadow-sm"><div class="flex items-center justify-between mb-2"><p class="text-sm text-gray-600 font-semibold">Avg Engagement/User</p><i class="fas fa-stopwatch text-purple-400 text-xl"></i></div><p class="text-3xl font-bold text-purple-700">' + (m.avgEngagementTimePerUser || '0s') + '</p><p class="text-xs text-gray-500 mt-1">Time per user</p></div>' +
                        '</div></div>' +
                        
                        // Engagement Metrics Section
                        '<div class="glass-effect rounded-xl p-6"><h3 class="text-xl font-bold text-gray-800 mb-4"><i class="fas fa-heart mr-2 text-pink-500"></i> Engagement Analysis</h3>' +
                        '<div class="grid grid-cols-2 md:grid-cols-4 gap-4">' +
                        '<div class="p-4 bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2 font-semibold">Engagement Rate</p><p class="text-2xl font-bold text-pink-600">' + (m.engagementRate || '0%') + '</p><p class="text-xs text-gray-500 mt-1">Quality sessions</p></div>' +
                        '<div class="p-4 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2 font-semibold">Engaged Sessions</p><p class="text-2xl font-bold text-indigo-600">' + (m.engagedSessions || '0') + '</p><p class="text-xs text-gray-500 mt-1">' + (m.engagementSessionPercent || '0%') + ' of all sessions</p></div>' +
                        '<div class="p-4 bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2 font-semibold">Avg Time/Session</p><p class="text-2xl font-bold text-teal-600">' + (m.avgEngagementTimePerSession || '0s') + '</p><p class="text-xs text-gray-500 mt-1">Per session</p></div>' +
                        '<div class="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2 font-semibold">Total Engagement</p><p class="text-2xl font-bold text-yellow-600">' + Math.round((m.totalEngagementTime || 0) / 60) + 'm</p><p class="text-xs text-gray-500 mt-1">Total time</p></div>' +
                        '</div></div>' +
                        
                        // Session Behavior Section
                        '<div class="glass-effect rounded-xl p-6"><h3 class="text-xl font-bold text-gray-800 mb-4"><i class="fas fa-chart-bar mr-2 text-green-500"></i> Session Behavior</h3>' +
                        '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
                        '<div class="p-5 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-sm"><div class="flex items-center justify-between mb-2"><p class="text-sm text-gray-600 font-semibold">Avg Session Duration</p><i class="fas fa-clock text-blue-400 text-xl"></i></div><p class="text-3xl font-bold text-blue-700">' + (m.avgSessionDuration || '0s') + '</p><p class="text-xs text-gray-500 mt-1">Time on site</p></div>' +
                        '<div class="p-5 bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow-sm"><div class="flex items-center justify-between mb-2"><p class="text-sm text-gray-600 font-semibold">Pages per Session</p><i class="fas fa-file-alt text-green-400 text-xl"></i></div><p class="text-3xl font-bold text-green-700">' + (m.pagesPerSession || '0') + '</p><p class="text-xs text-gray-500 mt-1">Page depth</p></div>' +
                        '<div class="p-5 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg shadow-sm"><div class="flex items-center justify-between mb-2"><p class="text-sm text-gray-600 font-semibold">Bounce Rate</p><i class="fas fa-sign-out-alt text-orange-400 text-xl"></i></div><p class="text-3xl font-bold text-orange-700">' + (m.bounceRate || '0%') + '</p><p class="text-xs text-gray-500 mt-1">Single-page visits</p></div>' +
                        '</div></div>' +
                        
                        // Summary Card
                        '<div class="glass-effect rounded-xl p-6 bg-gradient-to-br from-indigo-50 to-purple-50"><h3 class="text-xl font-bold text-gray-800 mb-4"><i class="fas fa-lightbulb mr-2 text-yellow-500"></i> Quick Insights</h3>' +
                        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
                        '<div class="p-4 bg-white rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2">👥 <strong>Audience Split</strong></p><p class="text-lg text-gray-800">New: ' + (m.newUsersPercent || '0%') + ' | Returning: ' + (m.returningUsersPercent || '0%') + '</p></div>' +
                        '<div class="p-4 bg-white rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2">💡 <strong>Engagement Quality</strong></p><p class="text-lg text-gray-800">' + (m.engagementSessionPercent || '0%') + ' of sessions are engaged</p></div>' +
                        '<div class="p-4 bg-white rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2">📊 <strong>Average Experience</strong></p><p class="text-lg text-gray-800">' + (m.pagesPerSession || '0') + ' pages in ' + (m.avgSessionDuration || '0s') + '</p></div>' +
                        '<div class="p-4 bg-white rounded-lg shadow-sm"><p class="text-sm text-gray-600 mb-2">⏱️ <strong>Total Time Spent</strong></p><p class="text-lg text-gray-800">' + Math.round((m.totalEngagementTime || 0) / 3600) + ' hours of engagement</p></div>' +
                        '</div></div>' +
                        
                        '</div>';
                } else {
                    const msg = response.data.message || '';
                    container.innerHTML = '<div class="glass-effect rounded-xl p-12 text-center">' +
                                        '<i class="fas fa-chart-line text-6xl text-gray-300 mb-4"></i>' +
                                        '<h3 class="text-xl font-bold text-gray-800 mb-2">No Data Available</h3>' +
                                        '<p class="text-gray-600">Analytics data is not available for this property.</p>' +
                                        (msg ? '<p class="text-sm text-gray-500 mt-2">' + msg + '</p>' : '') + '</div>';
                }
            } catch (error) {
                console.error('Error loading Analytics data:', error);
                const errMsg = (error.response && error.response.data && error.response.data.error) || error.message || 'Failed to load analytics data';
                container.innerHTML = '<div class="glass-effect rounded-xl p-12 text-center">' +
                                    '<i class="fas fa-exclamation-circle text-6xl text-red-400 mb-4"></i>' +
                                    '<h3 class="text-xl font-bold text-gray-800 mb-2">Error Loading Analytics Data</h3>' +
                                    '<p class="text-gray-600">' + errMsg + '</p>' +
                                    '<button onclick="loadAnalyticsData()" class="mt-4 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition">' +
                                    '<i class="fas fa-redo mr-2"></i> Retry</button></div>';
            }
        }

        
        function disconnectGoogleAds() {
            if (confirm('Are you sure you want to disconnect Google Ads?')) {
                localStorage.removeItem('google_ads_connected');
                document.getElementById('google-ads-connect').classList.remove('hidden');
                document.getElementById('google-ads-dashboard').classList.add('hidden');
                console.log('PinPointer: Google Ads disconnected');
            }
        }
        
        function disconnectAnalytics() {
            if (confirm('Are you sure you want to disconnect Google Analytics?')) {
                localStorage.removeItem('google_analytics_connected');
                document.getElementById('analytics-connect').classList.remove('hidden');
                document.getElementById('analytics-dashboard').classList.add('hidden');
                console.log('PinPointer: Google Analytics disconnected');
            }
        }
        
        // Load ad accounts on page load
        // Initialize application immediately (script is at end of body, DOM is ready)
        console.log('PinPointer: Initializing application');
        
        // Setup tab click handlers
        document.getElementById('tab-meta').addEventListener('click', () => showTab('meta'));
        document.getElementById('tab-google-ads').addEventListener('click', () => showTab('google-ads'));
        document.getElementById('tab-analytics').addEventListener('click', () => showTab('analytics'));
        document.getElementById('tab-tiktok').addEventListener('click', () => showTab('tiktok'));
        
        console.log('PinPointer: Tab handlers attached');
        
        // Show Meta tab by default
        showTab('meta');
        
        // Load Meta Ads accounts
        loadAdAccounts();
        
        // Check Google Ads connection status
        if (localStorage.getItem('google_ads_connected') === 'true') {
            document.getElementById('google-ads-connect').classList.add('hidden');
            document.getElementById('google-ads-dashboard').classList.remove('hidden');
            loadGoogleAdsAccounts();
        }
        
        // Check Google Analytics connection status
        if (localStorage.getItem('google_analytics_connected') === 'true') {
            document.getElementById('analytics-connect').classList.add('hidden');
            document.getElementById('analytics-dashboard').classList.remove('hidden');
            loadAnalyticsProperties();
        }
        
        console.log('PinPointer: Initialization complete');
        
        // Check if we're returning from OAuth
        const oauthCode = sessionStorage.getItem('oauth_code');
        const oauthState = sessionStorage.getItem('oauth_state');
        
        if (oauthCode && oauthState) {
            console.log('PinPointer: Processing OAuth callback - state:', oauthState);
            
            // Clear sessionStorage
            sessionStorage.removeItem('oauth_code');
            sessionStorage.removeItem('oauth_state');
            
            // Exchange code for token based on state
            if (oauthState === 'google-ads') {
                exchangeGoogleAdsCode(oauthCode);
            } else if (oauthState === 'google-analytics') {
                exchangeGoogleAnalyticsCode(oauthCode);
            }
        }
        
        async function loadAdAccounts() {
            try {
                const response = await axios.get('/api/me/adaccounts');
                const select = document.getElementById('adAccountSelect');
                
                if (response.data.data && response.data.data.length > 0) {
                    select.innerHTML = '<option value="">Select an ad account...</option>';
                    response.data.data.forEach(account => {
                        const option = document.createElement('option');
                        option.value = account.account_id;
                        option.textContent = \`\${account.name} (ID: \${account.account_id})\`;
                        option.dataset.account = JSON.stringify(account);
                        select.appendChild(option);
                    });
                } else {
                    console.log('PinPointer: No accounts found');
                    select.innerHTML = '<option value="">No ad accounts found</option>';
                }
            } catch (error) {
                console.error('PinPointer: Error loading ad accounts:', error);
                document.getElementById('adAccountSelect').innerHTML = '<option value="">Error loading accounts</option>';
            }
        }
        
        async function loadCampaigns() {
            const select = document.getElementById('adAccountSelect');
            const accountId = select.value;
            
            if (!accountId) {
                document.getElementById('campaignsList').innerHTML = '<div class="text-center py-12"><p class="text-gray-600">Select an ad account to view campaigns</p></div>';
                return;
            }
            
            const selectedOption = select.options[select.selectedIndex];
            currentAccount = JSON.parse(selectedOption.dataset.account);
            
            const campaignsList = document.getElementById('campaignsList');
            campaignsList.innerHTML = '<div class="text-center py-12 loading"><i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i><p class="mt-4 text-gray-600">Loading campaigns...</p></div>';
            
            try {
                const response = await axios.get(\`/api/account/\${accountId}/campaigns\`);
                campaigns = response.data.data || [];
                
                if (campaigns.length === 0) {
                    campaignsList.innerHTML = '<div class="text-center py-12"><i class="fas fa-inbox text-4xl text-gray-400"></i><p class="mt-4 text-gray-600">No campaigns found in this account</p></div>';
                    return;
                }
                
                campaignsList.innerHTML = '';
                
                for (const campaign of campaigns) {
                    await loadCampaignCard(campaign);
                }
            } catch (error) {
                console.error('Error loading campaigns:', error);
                campaignsList.innerHTML = '<div class="text-center py-12"><i class="fas fa-exclamation-triangle text-4xl text-red-400"></i><p class="mt-4 text-red-600">Error loading campaigns: ' + (error.response?.data?.error || error.message) + '</p></div>';
            }
        }
        
        // Get the dynamic "Results" metric based on campaign objective
        function getResultMetricForObjective(objective, insights) {
            const obj = (objective || '').toUpperCase();
            
            // AWARENESS & REACH campaigns
            if (obj.includes('AWARENESS') || obj.includes('REACH') || obj.includes('BRAND')) {
                return {
                    icon: 'fa-users',
                    label: 'Reach',
                    value: formatNumber(insights.reach || 0),
                    metric1: '<i class="fas fa-redo mr-1"></i>Frequency: ' + parseFloat(insights.frequency || 0).toFixed(2),
                    metric2: 'CPP: $' + parseFloat(insights.cpp || 0).toFixed(2)
                };
            }
            
            // TRAFFIC campaigns - Show CLICKS (not link clicks)
            else if (obj.includes('TRAFFIC') || obj.includes('LINK_CLICKS')) {
                return {
                    icon: 'fa-mouse-pointer',
                    label: 'Clicks',
                    value: formatNumber(insights.clicks || 0),
                    metric1: '<i class="fas fa-link mr-1"></i>Link Clicks: ' + formatNumber(insights.inline_link_clicks || 0),
                    metric2: 'Link CTR: ' + parseFloat(insights.inline_link_click_ctr || 0).toFixed(2) + '%'
                };
            }
            
            // ENGAGEMENT campaigns - Show ENGAGEMENTS (including link clicks)
            else if (obj.includes('ENGAGEMENT') || obj.includes('POST')) {
                // Calculate total engagements including link clicks
                const postEngagements = parseInt(insights.post_engagements || 0);
                const linkClicks = parseInt(insights.inline_link_clicks || 0);
                const totalEngagements = postEngagements + linkClicks;
                
                return {
                    icon: 'fa-heart',
                    label: 'Engagements',
                    value: formatNumber(totalEngagements),
                    metric1: '<i class="fas fa-thumbs-up mr-1"></i>Post Eng: ' + formatNumber(postEngagements),
                    metric2: 'CPE: $' + parseFloat(insights.cost_per_engagement || 0).toFixed(2)
                };
            }
            
            // APP INSTALL campaigns
            else if (obj.includes('APP') || obj.includes('MOBILE')) {
                const installs = parseInt(insights.conversions || 0);
                const cpi = installs > 0 ? (parseFloat(insights.spend) / installs).toFixed(2) : '0.00';
                return {
                    icon: 'fa-mobile-alt',
                    label: 'Installs',
                    value: formatNumber(installs),
                    metric1: '<i class="fas fa-download mr-1"></i>CPI: $' + cpi,
                    metric2: 'Install Rate: ' + parseFloat(insights.conversion_rate || 0).toFixed(2) + '%'
                };
            }
            
            // LEAD GENERATION campaigns
            else if (obj.includes('LEAD') || obj.includes('OUTCOME_LEADS')) {
                const leads = parseInt(insights.leads || insights.conversions || 0);
                const cpl = leads > 0 ? (parseFloat(insights.spend) / leads).toFixed(2) : '0.00';
                return {
                    icon: 'fa-user-plus',
                    label: 'Leads',
                    value: formatNumber(leads),
                    metric1: '<i class="fas fa-dollar-sign mr-1"></i>CPL: $' + cpl,
                    metric2: 'Conv Rate: ' + parseFloat(insights.conversion_rate || 0).toFixed(2) + '%'
                };
            }
            
            // SALES & CONVERSIONS campaigns
            else if (obj.includes('SALES') || obj.includes('CONVERSIONS') || obj.includes('OUTCOME_SALES') || obj.includes('CATALOG')) {
                const purchases = parseInt(insights.purchases || insights.conversions || 0);
                const cpa = purchases > 0 ? (parseFloat(insights.spend) / purchases).toFixed(2) : '0.00';
                return {
                    icon: 'fa-shopping-cart',
                    label: 'Purchases',
                    value: formatNumber(purchases),
                    metric1: '<i class="fas fa-dollar-sign mr-1"></i>CPA: $' + cpa,
                    metric2: 'Conv Rate: ' + parseFloat(insights.conversion_rate || 0).toFixed(2) + '%'
                };
            }
            
            // VIDEO VIEWS campaigns
            else if (obj.includes('VIDEO')) {
                const videoViews = parseInt(insights.video_views || 0);
                const cpv = videoViews > 0 ? (parseFloat(insights.spend) / videoViews).toFixed(2) : '0.00';
                const viewRate = videoViews > 0 && insights.impressions > 0 ? ((videoViews / parseInt(insights.impressions)) * 100).toFixed(2) : '0.00';
                return {
                    icon: 'fa-play-circle',
                    label: 'Video Views',
                    value: formatNumber(videoViews),
                    metric1: '<i class="fas fa-dollar-sign mr-1"></i>CPV: $' + cpv,
                    metric2: 'View Rate: ' + viewRate + '%'
                };
            }
            
            // DEFAULT - Show Conversions
            else {
                return {
                    icon: 'fa-check-circle',
                    label: 'Conversions',
                    value: formatNumber(insights.conversions || 0),
                    metric1: '<i class="fas fa-percentage mr-1"></i>Conv Rate: ' + parseFloat(insights.conversion_rate || 0).toFixed(2) + '%',
                    metric2: 'Cost/Conv: $' + parseFloat(insights.cost_per_conversion || 0).toFixed(2)
                };
            }
        }
        
        // Get objective-specific KPIs based on campaign objective
        function getObjectiveKPIs(objective, insights) {
            const obj = (objective || '').toUpperCase();
            
            // Default KPIs shown for all objectives
            const baseKPIs = {
                ctr: { label: 'CTR', value: parseFloat(insights.ctr || 0).toFixed(2) + '%', target: '1.5-2.5%', good: parseFloat(insights.ctr || 0) >= 1.5 },
                cpc: { label: 'CPC', value: '$' + parseFloat(insights.cpc || 0).toFixed(2), target: '<$1.50', good: parseFloat(insights.cpc || 0) <= 1.5 },
                frequency: { label: 'Frequency', value: parseFloat(insights.frequency || 0).toFixed(2), target: '1.5-3.0', good: parseFloat(insights.frequency || 0) <= 3 },
                cpm: { label: 'CPM', value: '$' + parseFloat(insights.cpm || 0).toFixed(2), target: '$5-$15', good: parseFloat(insights.cpm || 0) <= 15 },
                engagement_rate: { label: 'Engagement Rate', value: parseFloat(insights.engagement_rate || 0).toFixed(2) + '%', target: '>0.15%', good: parseFloat(insights.engagement_rate || 0) > 0.15 }
            };
            
            // Objective-specific KPIs
            if (obj.includes('AWARENESS') || obj.includes('REACH') || obj.includes('BRAND')) {
                return [
                    baseKPIs.cpm,
                    { label: 'Reach', value: formatNumber(insights.reach), target: 'Maximize', good: true },
                    baseKPIs.frequency,
                    { label: 'CPP', value: '$' + parseFloat(insights.cpp || 0).toFixed(2), target: '<$10', good: parseFloat(insights.cpp || 0) <= 10 },
                    baseKPIs.engagement_rate
                ];
            } else if (obj.includes('TRAFFIC') || obj.includes('LINK_CLICKS')) {
                return [
                    baseKPIs.ctr,
                    baseKPIs.cpc,
                    { label: 'Clicks', value: formatNumber(insights.clicks || 0), target: 'Maximize', good: true },
                    { label: 'Link CTR', value: parseFloat(insights.inline_link_click_ctr || 0).toFixed(2) + '%', target: '>1.5%', good: parseFloat(insights.inline_link_click_ctr || 0) >= 1.5 },
                    { label: 'Link Clicks', value: formatNumber(insights.inline_link_clicks || 0), target: 'Maximize', good: true }
                ];
            } else if (obj.includes('ENGAGEMENT') || obj.includes('POST')) {
                // Total engagements = post engagements + link clicks
                const postEngs = parseInt(insights.post_engagements || 0);
                const linkClicks = parseInt(insights.inline_link_clicks || 0);
                const totalEngs = postEngs + linkClicks;
                
                return [
                    baseKPIs.engagement_rate,
                    { label: 'Total Engagements', value: formatNumber(totalEngs), target: 'Maximize', good: true },
                    { label: 'Link Clicks', value: formatNumber(linkClicks), target: 'Maximize', good: true },
                    { label: 'CPE', value: '$' + parseFloat(insights.cost_per_engagement || 0).toFixed(2), target: '<$0.10', good: parseFloat(insights.cost_per_engagement || 0) <= 0.10 },
                    baseKPIs.frequency
                ];
            } else if (obj.includes('APP') || obj.includes('MOBILE')) {
                const installs = parseInt(insights.conversions || 0);
                const cpi = installs > 0 ? (parseFloat(insights.spend) / installs).toFixed(2) : '0.00';
                return [
                    { label: 'CPI', value: '$' + cpi, target: '<$3.00', good: parseFloat(cpi) <= 3 },
                    { label: 'Installs', value: formatNumber(installs), target: 'Maximize', good: true },
                    baseKPIs.ctr,
                    baseKPIs.cpc,
                    { label: 'Install Rate', value: parseFloat(insights.conversion_rate || 0).toFixed(2) + '%', target: '>5%', good: parseFloat(insights.conversion_rate || 0) >= 5 }
                ];
            } else if (obj.includes('LEAD') || obj.includes('OUTCOME_LEADS')) {
                const leads = parseInt(insights.leads || insights.conversions || 0);
                const cpl = leads > 0 ? (parseFloat(insights.spend) / leads).toFixed(2) : '0.00';
                return [
                    { label: 'CPL', value: '$' + cpl, target: '<$28', good: parseFloat(cpl) <= 28 },
                    { label: 'Leads', value: formatNumber(leads), target: 'Maximize', good: true },
                    { label: 'Conv Rate', value: parseFloat(insights.conversion_rate || 0).toFixed(2) + '%', target: '>7.7%', good: parseFloat(insights.conversion_rate || 0) >= 7.7 },
                    baseKPIs.ctr,
                    baseKPIs.cpc
                ];
            } else if (obj.includes('SALES') || obj.includes('CONVERSIONS') || obj.includes('OUTCOME_SALES') || obj.includes('CATALOG')) {
                const purchases = parseInt(insights.purchases || insights.conversions || 0);
                const cpa = purchases > 0 ? (parseFloat(insights.spend) / purchases).toFixed(2) : '0.00';
                const roas = purchases > 0 ? ((purchases * 50) / parseFloat(insights.spend)).toFixed(2) : '0.00'; // Assuming $50 AOV
                return [
                    { label: 'CPA', value: '$' + cpa, target: '<$19', good: parseFloat(cpa) <= 19 },
                    { label: 'ROAS', value: roas + 'x', target: '>2.0x', good: parseFloat(roas) >= 2 },
                    { label: 'Purchases', value: formatNumber(purchases), target: 'Maximize', good: true },
                    { label: 'Conv Rate', value: parseFloat(insights.conversion_rate || 0).toFixed(2) + '%', target: '>9%', good: parseFloat(insights.conversion_rate || 0) >= 9 },
                    baseKPIs.ctr
                ];
            } else if (obj.includes('VIDEO')) {
                const videoViews = parseInt(insights.video_views || 0);
                const cpv = videoViews > 0 ? (parseFloat(insights.spend) / videoViews).toFixed(2) : '0.00';
                return [
                    { label: 'CPV', value: '$' + cpv, target: '<$0.03', good: parseFloat(cpv) <= 0.03 },
                    { label: 'Video Views', value: formatNumber(videoViews), target: 'Maximize', good: true },
                    { label: 'View Rate', value: (videoViews > 0 && insights.impressions > 0 ? ((videoViews / parseInt(insights.impressions)) * 100).toFixed(2) : '0.00') + '%', target: '>30%', good: (videoViews > 0 && insights.impressions > 0 ? ((videoViews / parseInt(insights.impressions)) * 100) : 0) >= 30 },
                    baseKPIs.cpm,
                    baseKPIs.ctr
                ];
            }
            
            // Default fallback KPIs
            return [
                baseKPIs.ctr,
                baseKPIs.cpc,
                baseKPIs.frequency,
                baseKPIs.cpm,
                { label: 'Conv Rate', value: parseFloat(insights.conversion_rate || 0).toFixed(2) + '%', target: '>2%', good: parseFloat(insights.conversion_rate || 0) >= 2 }
            ];
        }
        
        async function loadCampaignCard(campaign) {
            const campaignsList = document.getElementById('campaignsList');
            const dateRange = document.getElementById('dateRange').value;
            
            // Create campaign card
            const card = document.createElement('div');
            card.className = 'glass-effect rounded-xl p-6';
            card.innerHTML = \`
                <div class="flex items-start justify-between mb-4">
                    <div class="flex-1">
                        <div class="flex items-center space-x-3 mb-2">
                            <h3 class="text-xl font-bold text-gray-800">\${campaign.name}</h3>
                            <span class="px-3 py-1 text-xs font-semibold rounded-full \${getStatusBadge(campaign.status)}">
                                \${campaign.status}
                            </span>
                        </div>
                        <div class="flex items-center space-x-4 text-sm text-gray-600">
                            <span><i class="fas fa-bullseye mr-1"></i> <strong>Objective:</strong> \${formatObjective(campaign.objective)}</span>
                            <span><i class="fas fa-dollar-sign mr-1"></i> <strong>Budget:</strong> <span id="budget-\${campaign.id}">Loading...</span></span>
                            <span><i class="fas fa-calendar mr-1"></i> <strong>Created:</strong> \${formatDate(campaign.created_time)}</span>
                        </div>
                    </div>
                    <button onclick="showOptimization('\${campaign.id}', '\${campaign.objective}')" 
                            class="px-4 py-2 bg-pinpoint-pink text-white rounded-lg hover:bg-pinpoint-red transition flex items-center shadow-md">
                        <i class="fas fa-magic mr-2"></i> Optimize
                    </button>
                </div>
                
                <div id="metrics-\${campaign.id}" class="mt-4">
                    <div class="animate-pulse flex space-x-4">
                        <div class="h-24 bg-gray-200 rounded flex-1"></div>
                        <div class="h-24 bg-gray-200 rounded flex-1"></div>
                        <div class="h-24 bg-gray-200 rounded flex-1"></div>
                        <div class="h-24 bg-gray-200 rounded flex-1"></div>
                    </div>
                </div>
            \`;
            
            campaignsList.appendChild(card);
            
            // Load budget asynchronously
            formatBudget(campaign).then(budget => {
                const budgetEl = document.getElementById(\`budget-\${campaign.id}\`);
                if (budgetEl) budgetEl.textContent = budget;
            });
            
            // Load insights
            try {
                const response = await axios.get(\`/api/campaign/\${campaign.id}/insights?date_preset=\${dateRange}\`);
                
                if (response.data.error) {
                    document.getElementById(\`metrics-\${campaign.id}\`).innerHTML = \`
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
                            <i class="fas fa-exclamation-triangle mr-2"></i>
                            Unable to load metrics: \${response.data.error}
                        </div>
                    \`;
                    return;
                }
                
                const insights = response.data.data && response.data.data[0];
                
                if (!insights) {
                    document.getElementById(\`metrics-\${campaign.id}\`).innerHTML = \`
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                            <i class="fas fa-info-circle mr-2"></i>
                            No performance data available yet. Campaign may be too new or paused.
                        </div>
                    \`;
                    return;
                }
                
                // Get objective-based result metric
                const resultMetric = getResultMetricForObjective(campaign.objective, insights);
                
                document.getElementById(\`metrics-\${campaign.id}\`).innerHTML = \`
                    <div class="grid grid-cols-4 gap-4">
                        <!-- Card 1: Impressions -->
                        <div class="metric-card bg-gradient-to-br from-blue-500 to-blue-600 p-5 rounded-lg text-white">
                            <div class="flex items-center justify-between mb-2">
                                <i class="fas fa-eye text-2xl opacity-75"></i>
                                <span class="kpi-badge">Impressions</span>
                            </div>
                            <div class="text-3xl font-bold mt-2">\${formatNumber(insights.impressions)}</div>
                            <div class="text-xs opacity-90 mt-2">
                                <span><i class="fas fa-percentage mr-1"></i>CTR: \${parseFloat(insights.ctr || 0).toFixed(2)}%</span>
                            </div>
                            <div class="text-xs mt-1 opacity-75">CPM: $\${parseFloat(insights.cpm || 0).toFixed(2)}</div>
                        </div>
                        
                        <!-- Card 2: Reach -->
                        <div class="metric-card bg-gradient-to-br from-green-500 to-green-600 p-5 rounded-lg text-white">
                            <div class="flex items-center justify-between mb-2">
                                <i class="fas fa-users text-2xl opacity-75"></i>
                                <span class="kpi-badge">Reach</span>
                            </div>
                            <div class="text-3xl font-bold mt-2">\${formatNumber(insights.reach)}</div>
                            <div class="text-xs opacity-90 mt-2">
                                <span><i class="fas fa-redo mr-1"></i>Frequency: \${parseFloat(insights.frequency || 0).toFixed(2)}</span>
                            </div>
                            <div class="text-xs mt-1 opacity-75">CPP: $\${parseFloat(insights.cpp || 0).toFixed(2)}</div>
                        </div>
                        
                        <!-- Card 3: Results (Dynamic based on objective) -->
                        <div class="metric-card bg-gradient-to-br from-orange-500 to-orange-600 p-5 rounded-lg text-white">
                            <div class="flex items-center justify-between mb-2">
                                <i class="fas \${resultMetric.icon} text-2xl opacity-75"></i>
                                <span class="kpi-badge">\${resultMetric.label}</span>
                            </div>
                            <div class="text-3xl font-bold mt-2">\${resultMetric.value}</div>
                            <div class="text-xs opacity-90 mt-2">
                                <span>\${resultMetric.metric1}</span>
                            </div>
                            <div class="text-xs mt-1 opacity-75">\${resultMetric.metric2}</div>
                        </div>
                        
                        <!-- Card 4: Spend -->
                        <div class="metric-card bg-gradient-to-br from-purple-500 to-purple-600 p-5 rounded-lg text-white">
                            <div class="flex items-center justify-between mb-2">
                                <i class="fas fa-dollar-sign text-2xl opacity-75"></i>
                                <span class="kpi-badge">Spend</span>
                            </div>
                            <div class="text-3xl font-bold mt-2">$\${parseFloat(insights.spend || 0).toFixed(2)}</div>
                            <div class="text-xs opacity-90 mt-2">
                                <span><i class="fas fa-mouse-pointer mr-1"></i>Clicks: \${formatNumber(insights.clicks)}</span>
                            </div>
                            <div class="text-xs mt-1 opacity-75">CPC: $\${parseFloat(insights.cpc || 0).toFixed(2)}</div>
                        </div>
                    </div>
                    
                    <!-- Key KPIs Summary - Dynamic based on objective -->
                    <div class="mt-4 bg-gray-50 rounded-lg p-4">
                        <h4 class="text-sm font-semibold text-gray-700 mb-3">
                            <i class="fas fa-chart-bar mr-2"></i>Key Performance Indicators for \${formatObjective(campaign.objective)}
                        </h4>
                        <div class="grid grid-cols-5 gap-3 text-sm">
                            \${getObjectiveKPIs(campaign.objective, insights).map(kpi => \`
                                <div class="bg-white p-3 rounded border">
                                    <div class="text-gray-500 text-xs mb-1">\${kpi.label}</div>
                                    <div class="font-bold text-lg \${kpi.good ? 'text-green-600' : 'text-orange-600'}">
                                        \${kpi.value}
                                    </div>
                                    <div class="text-xs text-gray-400">Target: \${kpi.target}</div>
                                </div>
                            \`).join('')}
                        </div>
                    </div>
                \`;
                
                // Store insights for optimization
                campaign.insights = insights;
            } catch (error) {
                console.error('Error loading insights:', error);
                document.getElementById(\`metrics-\${campaign.id}\`).innerHTML = \`
                    <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                        <i class="fas fa-exclamation-circle mr-2"></i>
                        Error loading metrics: \${error.response?.data?.error || error.message}
                    </div>
                \`;
            }
        }
        
        async function showOptimization(campaignId, objective) {
            const campaign = campaigns.find(c => c.id === campaignId);
            if (!campaign || !campaign.insights) {
                alert('Please wait for campaign data to load completely before viewing optimization suggestions.');
                return;
            }
            
            const modal = document.getElementById('optimizationModal');
            const content = document.getElementById('optimizationContent');
            
            content.innerHTML = '<div class="text-center py-12 loading"><i class="fas fa-brain fa-spin text-4xl text-purple-400"></i><p class="mt-4 text-gray-600">AI is analyzing your campaign data...</p><p class="text-sm text-gray-500 mt-2">Evaluating ' + (Object.keys(campaign.insights).length) + ' data points</p></div>';
            modal.classList.remove('hidden');
            
            try {
                const response = await axios.post('/api/optimize/suggestions', {
                    insights: { data: [campaign.insights] },
                    objective: objective,
                    campaignData: campaign
                });
                
                const suggestions = response.data.suggestions;
                
                if (suggestions.length === 0) {
                    content.innerHTML = '<div class="text-center py-12"><i class="fas fa-check-circle text-6xl text-green-400"></i><p class="mt-4 text-lg text-gray-700">No optimization suggestions at this time.</p><p class="text-gray-500 mt-2">Your campaign appears to be performing well!</p></div>';
                    return;
                }
                
                content.innerHTML = \`
                    <div class="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                        <div class="flex items-start">
                            <i class="fas fa-lightbulb text-3xl text-yellow-500 mr-4"></i>
                            <div>
                                <h4 class="font-bold text-lg text-gray-800 mb-1">AI Analysis Complete</h4>
                                <p class="text-sm text-gray-600">
                                    Found <strong>\${suggestions.length}</strong> optimization opportunities for <strong>\${campaign.name}</strong>.
                                    These recommendations are based on Meta marketing best practices and your campaign data.
                                </p>
                                <p class="text-xs text-purple-600 mt-2 font-semibold">
                                    ⚠️ IMPORTANT: These are suggestions only - please review and implement them manually in your Meta Ads Manager.
                                </p>
                            </div>
                        </div>
                    </div>
                \` + suggestions.map((suggestion, index) => \`
                    <div class="mb-5 rounded-lg border-l-4 \${getSuggestionStyle(suggestion.type)} p-5 shadow-sm hover:shadow-md transition">
                        <div class="flex items-start">
                            <i class="fas \${getSuggestionIcon(suggestion.type)} text-3xl mr-4 flex-shrink-0 mt-1"></i>
                            <div class="flex-1">
                                <div class="flex items-start justify-between mb-2">
                                    <h4 class="text-lg font-bold text-gray-800">\${suggestion.title}</h4>
                                    <span class="px-3 py-1 text-xs font-bold rounded-full ml-4 flex-shrink-0 \${getPriorityBadge(suggestion.priority)}">
                                        \${suggestion.priority.toUpperCase()}
                                    </span>
                                </div>
                                
                                <p class="text-gray-700 mb-3 leading-relaxed">\${suggestion.description}</p>
                                
                                \${suggestion.kpi ? \`
                                    <div class="grid grid-cols-3 gap-3 mb-3 p-3 bg-gray-50 rounded">
                                        <div>
                                            <div class="text-xs text-gray-500">KPI</div>
                                            <div class="font-semibold text-sm">\${suggestion.kpi}</div>
                                        </div>
                                        <div>
                                            <div class="text-xs text-gray-500">Current Value</div>
                                            <div class="font-semibold text-sm text-red-600">\${suggestion.currentValue}</div>
                                        </div>
                                        <div>
                                            <div class="text-xs text-gray-500">Target Value</div>
                                            <div class="font-semibold text-sm text-green-600">\${suggestion.targetValue}</div>
                                        </div>
                                    </div>
                                \` : ''}
                                
                                \${suggestion.recommendations ? \`
                                    <div class="mt-4 bg-white rounded-lg p-4 border border-gray-200">
                                        <p class="font-bold text-sm mb-3 text-gray-700 flex items-center">
                                            <i class="fas fa-tasks mr-2 text-purple-600"></i>
                                            Action Steps to Implement:
                                        </p>
                                        <ul class="space-y-2">
                                            \${suggestion.recommendations.map((rec, idx) => \`
                                                <li class="flex items-start text-sm">
                                                    <span class="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">
                                                        \${idx + 1}
                                                    </span>
                                                    <span class="flex-1 text-gray-700">\${rec}</span>
                                                </li>
                                            \`).join('')}
                                        </ul>
                                    </div>
                                \` : ''}
                                
                                \${suggestion.impact ? \`
                                    <div class="mt-3 flex items-center text-sm">
                                        <i class="fas fa-bolt text-yellow-500 mr-2"></i>
                                        <span class="font-semibold text-gray-600">Expected Impact:</span>
                                        <span class="ml-2 text-gray-700">\${suggestion.impact}</span>
                                    </div>
                                \` : ''}
                            </div>
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Error getting suggestions:', error);
                content.innerHTML = \`
                    <div class="text-center py-12">
                        <i class="fas fa-exclamation-triangle text-6xl text-red-400"></i>
                        <p class="mt-4 text-lg text-red-600">Error generating suggestions</p>
                        <p class="text-sm text-gray-500 mt-2">\${error.response?.data?.error || error.message}</p>
                    </div>
                \`;
            }
        }
        
        function closeOptimizationModal() {
            document.getElementById('optimizationModal').classList.add('hidden');
        }
        
        function refreshData() {
            if (document.getElementById('adAccountSelect').value) {
                loadCampaigns();
            }
        }
        
        // Utility functions
        function formatNumber(num) {
            if (!num) return '0';
            return parseInt(num).toLocaleString();
        }
        
        async function formatBudget(campaign) {
            // Check if budget is set at campaign level first
            if (campaign.daily_budget) {
                return \`$\${(parseFloat(campaign.daily_budget) / 100).toFixed(2)}/day\`;
            } else if (campaign.lifetime_budget) {
                return \`$\${(parseFloat(campaign.lifetime_budget) / 100).toFixed(2)} lifetime\`;
            }
            
            // If no campaign budget, check ad set budgets
            try {
                const response = await axios.get(\`/api/campaign/\${campaign.id}/adsets/budget\`);
                if (response.data.data && response.data.data.length > 0) {
                    let totalDaily = 0;
                    let totalLifetime = 0;
                    let hasDaily = false;
                    let hasLifetime = false;
                    
                    response.data.data.forEach(adset => {
                        if (adset.daily_budget) {
                            totalDaily += parseFloat(adset.daily_budget);
                            hasDaily = true;
                        }
                        if (adset.lifetime_budget) {
                            totalLifetime += parseFloat(adset.lifetime_budget);
                            hasLifetime = true;
                        }
                    });
                    
                    if (hasDaily) {
                        return \`$\${(totalDaily / 100).toFixed(2)}/day (ad set total)\`;
                    } else if (hasLifetime) {
                        return \`$\${(totalLifetime / 100).toFixed(2)} lifetime (ad set total)\`;
                    }
                }
            } catch (error) {
                console.error('Error fetching ad set budgets:', error);
            }
            
            return 'Not set';
        }
        
        function formatDate(dateString) {
            return new Date(dateString).toLocaleDateString();
        }
        
        function formatObjective(objective) {
            return objective.replace(/_/g, ' ').toLowerCase().replace(/\\b\\w/g, l => l.toUpperCase());
        }
        
        function getStatusBadge(status) {
            const badges = {
                'ACTIVE': 'bg-green-100 text-green-800',
                'PAUSED': 'bg-yellow-100 text-yellow-800',
                'ARCHIVED': 'bg-gray-100 text-gray-800',
                'DELETED': 'bg-red-100 text-red-800'
            };
            return badges[status] || 'bg-gray-100 text-gray-800';
        }
        
        function getPriorityBadge(priority) {
            const badges = {
                'critical': 'bg-red-600 text-white',
                'high': 'bg-orange-500 text-white',
                'medium': 'bg-yellow-500 text-white',
                'low': 'bg-blue-500 text-white'
            };
            return badges[priority] || 'bg-gray-500 text-white';
        }
        
        function getSuggestionStyle(type) {
            const styles = {
                'error': 'border-red-500 bg-red-50',
                'warning': 'border-yellow-500 bg-yellow-50',
                'success': 'border-green-500 bg-green-50',
                'info': 'border-blue-500 bg-blue-50'
            };
            return styles[type] || 'border-gray-500 bg-gray-50';
        }
        
        function getSuggestionIcon(type) {
            const icons = {
                'error': 'fa-exclamation-circle text-red-500',
                'warning': 'fa-exclamation-triangle text-yellow-500',
                'success': 'fa-check-circle text-green-500',
                'info': 'fa-info-circle text-blue-500'
            };
            return icons[type] || 'fa-info-circle text-gray-500';
        }
        
        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeOptimizationModal();
            }
        });
    </script>
</body>
</html>
  `)
})

export default app
