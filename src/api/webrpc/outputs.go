package webrpc

import (
	"fmt"
	"strings"

	"github.com/MDLlife/MDL/src/cipher"
	"github.com/MDLlife/MDL/src/daemon"
	"github.com/MDLlife/MDL/src/visor"
)

// OutputsResult the output json format
type OutputsResult struct {
	Outputs visor.ReadableOutputSet `json:"outputs"`
}

func getOutputsHandler(req Request, gateway Gatewayer) Response {
	var addrs []string
	if err := req.DecodeParams(&addrs); err != nil {
		return makeErrorResponse(errCodeInvalidParams, errMsgInvalidParams)
	}

	if len(addrs) == 0 {
		return makeErrorResponse(errCodeInvalidParams, errMsgInvalidParams)
	}

	for i, a := range addrs {
		addrs[i] = strings.Trim(a, " ")
	}

	// validate those addresses
	for _, a := range addrs {
		if _, err := cipher.DecodeBase58Address(a); err != nil {
			return makeErrorResponse(errCodeInvalidParams, fmt.Sprintf("invalid address: %v", a))
		}
	}

	outs, err := gateway.GetUnspentOutputs(daemon.FbyAddresses(addrs))
	if err != nil {
		logger.Errorf("get unspent outputs failed: %v", err)
		return makeErrorResponse(errCodeInternalError, fmt.Sprintf("gateway.GetUnspentOutputs failed: %v", err))
	}

	return makeSuccessResponse(req.ID, OutputsResult{*outs})
}
